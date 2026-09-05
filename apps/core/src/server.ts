// =============================================================================
// JSON-RPC Server — CLI Backend
// Handles tools.list, tools.call, session.start, session.send, session.stop, providers.list
// =============================================================================

import { getTool, listTools } from "./tools/index.js";
import { listCommandInfos, resolveCommand } from "./commands/registry.js";
import { createAgentLoopEffect, type AgentLoop } from "./agent/loop.js";
import { getAppRuntime } from "./effect/runtime.js";
import { SessionStoreTag } from "./effect/context.js";
import { createMessageQueue, type MessageQueue } from "./queue-store.js";
import {
  initProviders,
  listProviders,
  getProvider,
  providerRequiresApiKey,
} from "./providers/index.js";
import {
  LOCAL_PROVIDERS,
  localProvider,
} from "./providers/local-catalogue.js";
import { MemoryService } from "./compaction/service.js";
import { createLlmSummarizer } from "./compaction/llm-summarizer.js";
import { applyCompaction } from "./session/compact-apply.js";
import {
  getProviders,
  getProviderModels,
  getModelContextLimit,
} from "./models-dev.js";
import {
  readConfig,
  redactConfig,
  writeConfig,
  setApiKey,
  setCurrentModel,
  hasApiKey,
  hasWebCredential,
  setWebCredential,
  getCurrentModel,
  getLastAgentMode,
  setLastAgentMode,
  type ProviderId,
  type WebCredentials,
} from "./providers/config.js";
import { logger } from "./utils/logger.js";
import { formatFatalError } from "./cli/format-fatal-error.js";
import type { ToolContext } from "./tools/types.js";
import type {
  JsonRpcRequest,
  JsonRpcResponse,
  SessionConfig,
  EffortLevel,
} from "@thisisayande/freecode-shared";
import {
  getMemoryStore,
  getMemoryGraphService,
  disposeSessionMemory,
  resetExtractPolicy,
  type MemoryEntry,
  type MemoryType,
} from "./memory/index.js";
import { buildMemoryPrompt } from "./memory/mem-prompt.js";
import { disposeOutputStore } from "./tools/output-store/index.js";
import { disposeReadState } from "./tools/read-state.js";
import { disposeCacheAwareness } from "./providers/cache-awareness.js";
import { disposeFrozenSessionContext } from "./context/session-context.js";
import { buildContextBreakdown } from "./context/breakdown.js";
import type { AgentMode } from "./agent/types.js";
import { endSession, type SessionEndReason } from "./session/end-session.js";
import { flushSessionMemory } from "./memory/final-flush.js";
import { getSessionManager, type SessionContext } from "./session/index.js";
import { type SessionStore } from "./session/store.js";
import {
  getRemoteSync,
  type ExportedSession,
  type RemoteSessionConfig,
} from "./store/index.js";
import { getInterruptHandler } from "./session/interrupt.js";
import { generateTitleFromPrompt } from "./agent/title-generator.js";
import { initMcpServers, listClients, getMcpTools } from "./mcp/index.js";
import { getConfigDir } from "./cli/utils/config.js";
import { initHooks } from "./hooks/bootstrap.js";
import {
  bus,
  BusEvents,
  answerQuestion,
  rejectQuestion,
  answerPermission,
  rejectPermission,
  type PermissionAnswer,
} from "./bus/index.js";
import { busEventToClientEvent } from "./bus/bridge.js";
import { publishToSession, publishToAll } from "./web/stream-subscribers.js";
import { readDailyUsage } from "./usage/tracker.js";
import { appendHistory, readHistoryDisplays } from "./history/store.js";
import { getSkillsManagerForProject } from "./skills/manager.js";
import { startGraphExplorer } from "./graph-explorer/server.js";
import { openBrowser } from "./utils/open-browser.js";
import { randomUUID } from "crypto";
import { existsSync } from "fs";
import {
  listClaudeSessions,
  readClaudeTranscript,
} from "./claude-sessions/index.js";
import type {
  ClaudeSessionMeta,
  ClaudeTranscript,
} from "@thisisayande/freecode-shared";

// SessionStore is resolved from the Effect runtime so the whole process shares
// the single DI-provided instance (layers memoize construction).
async function getSessionStore(): Promise<SessionStore> {
  return getAppRuntime().runPromise(SessionStoreTag);
}

// JSON-RPC error code returned when a question/permission prompt is answered
// but had already been resolved by another device or by the prompt timeout
// (spec §4.4). Distinct from a generic -32603 internal error so frontends
// can render it as a normal outcome ("Already answered on another device")
// rather than a failure.
const REQUEST_ALREADY_RESOLVED = -32002;

class JsonRpcError extends Error {
  constructor(public readonly code: number, message: string) {
    super(message);
    this.name = "JsonRpcError";
  }
}

// Loops with an in-flight turn, keyed by sessionId — session.stop and the
// SIGINT handler use this to abort provider/tool calls immediately.
const activeLoops = new Map<string, AgentLoop>();

// Per-session follow-up queues (spec 2026-08-05-queued-messages-design).
// When session.send lands while `activeLoops` already has an entry for this
// session, the new prompt is parked here instead of racing the in-flight turn.
// The loop's finally block drains the FIFO; session.dequeue removes an item
// by id for "drop" / "restore to editor" UX.
const messageQueues = new Map<string, MessageQueue>();
function getOrCreateQueue(sessionId: string): MessageQueue {
  let q = messageQueues.get(sessionId);
  if (!q) {
    q = createMessageQueue();
    messageQueues.set(sessionId, q);
  }
  return q;
}

interface ToolListItem {
  id: string;
  description: string;
}

interface ToolCallResult {
  title: string;
  output: string;
  metadata?: Record<string, unknown>;
}

interface SessionStartResult {
  sessionId: string;
}

interface SessionInfo {
  id: string;
  projectPath: string;
  provider: string;
  model?: string;
  effort?: EffortLevel;
}

export const sessions: Map<string, SessionInfo> = new Map();

// Resolved inputs to a single turn — the same shape the AgentLoop.runEffect()
// expects. The session.send handler and the FIFO-drain path both fill this in
// from their own sources (an inbound request vs. a QueuedMessage on the queue).
interface TurnInput {
  prompt: string;
  images?: Array<{ data: string; mediaType: string; altText?: string }>;
  provider: string;
  model?: string;
  effort?: EffortLevel;
  agentMode?:
    | "plan"
    | "build"
    | "review"
    | "explore"
    | "danger";
}

/**
 * Build, run, and clean up a single AgentLoop turn. The finally block drains
 * the session's follow-up queue (spec 2026-08-05): when the in-flight turn
 * finishes, the oldest queued message — if any — becomes the next turn, and
 * the loop stays "busy" through the recursive re-entry. Recursion bottoms out
 * when the queue is empty, at which point activeLoops is cleared.
 *
 * Re-entry intentionally goes through this helper rather than JSON-RPC
 * session.send: going back through the RPC layer would re-parse the queued
 * message, redo model/provider resolution, and acquire a new session-store
 * handle per turn — none of which is free, and none of which changes between
 * consecutive turns of the same session.
 */
async function runSessionTurn(
  session: SessionInfo,
  input: TurnInput,
): Promise<unknown> {
  const sessionId = session.id;
  // Construct the loop through the Effect runtime — memory, hooks, recorder,
  // orchestrator and session store are all DI-provided (v3 spec).
  // No maxIterations override: interactive sessions run unbounded, same as
  // Claude Code and opencode. loop-health + the todo/verify gates are what
  // end a run in practice.
  const loop = await getAppRuntime().runPromise(createAgentLoopEffect(sessionId));
  activeLoops.set(sessionId, loop);

  // Per-turn store handle for title-pinning below. Cheap (effect runtime
  // memoizes the underlying service) but doing it once per turn is clearer
  // than reaching for it from the finally handler too.
  const store = await getSessionStore();

  let result;
  try {
    result = await getAppRuntime().runPromise(
      loop.runEffect({
        prompt: input.prompt,
        sessionId,
        provider: input.provider,
        model: input.model,
        effort: input.effort,
        projectPath: session.projectPath,
        agentMode: input.agentMode,
        images: input.images,
      }),
    );

    // Emit done event through the single bus egress.
    BusEvents.stream(sessionId, {
      type: "done",
      content: result.message || "Done",
    });

    // Extract session title from first response (no extra API call).
    if (result.success && result.turnCount > 0 && result.content) {
      const titleMatch = result.content.match(/SESSION_TITLE:\s*(.+)/i);
      const title = titleMatch
        ? titleMatch[1].trim()
        : generateTitleFromPrompt(input.prompt);
      await store.updateMeta(sessionId, { title }, session.projectPath);
    }
  } finally {
    // Drain the queue *before* clearing busy state: if a queued message exists,
    // we re-enter runSessionTurn synchronously and activeLoops is overwritten
    // with the new loop. The pending recursive Promise keeps the activeLoops
    // map populated the whole time — there's no window where a session.send
    // could race the drain and miss the "busy" check.
    const queue = messageQueues.get(sessionId);
    const next = queue?.shiftNext();
    if (next) {
      // Fire-and-forget: the outer JSON-RPC promise for the *current* turn
      // resolves with `result` (or undefined on error); the next turn's
      // promise belongs to its own RPC call, not this one. Unhandled rejections
      // land in the same logger.error path the handler would take.
      runSessionTurn(session, {
        prompt: next.content,
        provider: input.provider,
        model: input.model,
        effort: input.effort,
        agentMode: input.agentMode,
      }).catch((err) => {
        const message = err instanceof Error ? err.message : String(err);
        logger.error("Queued session turn failed", { sessionId, message });
      });
    } else {
      activeLoops.delete(sessionId);
    }
  }

  return result;
}
// Per-session SSE subscriber fan-out lives in web/stream-subscribers.ts —
// each session owns a Set<Subscriber> rather than a single callback, and
// the module also runs the heartbeat/idle-reaper that prunes dead sockets.
// The web-server imports addSubscriber/removeSubscriber directly.

function createSession(config: SessionConfig): SessionInfo {
  const id = randomUUID();
  // Seed the model from config.json so it is pinned (and persisted to
  // meta.json) from the first turn. Left unset, session.model stays undefined
  // and every consumer downstream falls through to the provider's
  // defaultModel — which silently served MiniMax-M2 to sessions configured
  // for M3, overflowing M2's 196K window at ~20% of the displayed 1M meter.
  const current = readConfig().current;
  // No hardcoded provider fallback: an unconfigured provider is a setup error,
  // not something to guess at. Defaulting here sent requests to a provider the
  // user never chose, using that provider's default model.
  const provider = config.provider || current?.provider;
  if (!provider) {
    throw new Error(
      "No provider configured. Set current.provider in ~/.freecode/config.json, " +
        "or pass `provider` to session.start.",
    );
  }
  const session: SessionInfo = {
    id,
    projectPath: config.projectPath,
    provider,
    model: config.model || current?.model,
    effort: config.effort,
  };
  sessions.set(id, session);
  return session;
}

function getSession(id: string): SessionInfo | undefined {
  return sessions.get(id);
}

/**
 * End a session once, whatever ended it (spec D3).
 *
 * `flush` is opt-in per reason: switching away or quitting should mine the
 * conversation one last time (D4), but deleting a session must not — the user
 * is discarding it, and extracting from something they just threw away is the
 * one case where a memory write is clearly unwanted.
 *
 * Note `session.stop` is deliberately NOT a caller. It interrupts an in-flight
 * turn and keeps the session continuable, so disposing its caches would degrade
 * the next message. The spec lists it as an end reason; that is a spec error,
 * recorded in D3.
 */
async function endSessionOnce(
  sessionId: string,
  reason: SessionEndReason,
  options: { flush: boolean } = { flush: true },
): Promise<void> {
  const info = getSession(sessionId);
  await endSession(sessionId, {
    reason,
    also: () => messageQueues.delete(sessionId),
    flush:
      options.flush && info
        ? async () => {
            const store = await getSessionStore();
            const messages = await store.getMessages(sessionId);
            return flushSessionMemory({
              sessionId,
              projectPath: process.cwd(),
              provider: info.provider,
              messages,
            });
          }
        : undefined,
  });
}

function createResponse(id: number | string, result: unknown): JsonRpcResponse {
  return { jsonrpc: "2.0", id, result };
}

function createError(
  id: number | string,
  code: number,
  message: string,
  data?: unknown,
): JsonRpcResponse {
  return { jsonrpc: "2.0", id, error: { code, message, data } };
}

export const methodHandlers: Record<
  string,
  (params: Record<string, unknown>) => Promise<unknown>
> = {
  "tools.list": async (): Promise<ToolListItem[]> => {
    return listTools();
  },

  "tools.call": async (
    params: Record<string, unknown>,
  ): Promise<ToolCallResult> => {
    const { name, args } = params as {
      name: string;
      args: Record<string, unknown>;
    };
    const tool = getTool(name as string);
    if (!tool) {
      throw new Error(`Tool not found: ${name}`);
    }
    const ctx: ToolContext = { cwd: process.cwd() };
    const result = await tool.execute(args, ctx);
    if (!result.success) {
      throw new Error(result.error);
    }
    return result.result as ToolCallResult;
  },

  "session.start": async (
    params: Record<string, unknown>,
  ): Promise<SessionStartResult> => {
    const config = params as unknown as SessionConfig;
    if (!config.projectPath || !existsSync(config.projectPath)) {
      config.projectPath = process.cwd();
    }
    const session = createSession(config);
    // Store agentMode on session for later use
    if (config.agentMode) {
      (session as unknown as Record<string, unknown>).agentMode =
        config.agentMode;
    }
    logger.info("Session started", {
      sessionId: session.id,
      provider: session.provider,
      agentMode: config.agentMode,
    });

    // Persist session to ~/.freecode/sessions/ via SessionStore
    const store = await getSessionStore();
    // Use the same session ID that was created in createSession()
    await store.createSession(
      {
        title: `Session ${session.id}`,
        projectPath: session.projectPath,
        provider: session.provider,
        model: session.model,
      },
      session.id,
    );

    return { sessionId: session.id };
  },

  "session.send": async (params: Record<string, unknown>): Promise<unknown> => {
    const {
      sessionId,
      message,
      model,
      effort,
      agentMode: paramAgentMode,
      images,
    } = params as {
      sessionId: string;
      message: string;
      model?: string;
      effort?: EffortLevel;
      agentMode?: string;
      images?: Array<{ data: string; mediaType: string; altText?: string }>;
    };
    const session = getSession(sessionId);

    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    // A turn is already in progress for this session — park the prompt in the
    // follow-up queue instead of racing a second loop on the same sessionId
    // (which used to corrupt the message history). See queue-store.ts.
    //
    // Images are out of scope for v1: dropping them silently is data loss, so
    // the rejection forces the user to wait until the in-flight turn ends.
    if (activeLoops.has(sessionId)) {
      if (images && images.length > 0) {
        throw new Error(
          "Cannot queue a message with images while a turn is in progress. " +
            "Wait for the current turn to finish, then resubmit.",
        );
      }
      const id = getOrCreateQueue(sessionId).enqueue(message);
      BusEvents.stream(sessionId, {
        type: "message_queued",
        id,
        content: message,
      });
      return { queued: true, id } as const;
    }

    // Provider and model resolve through the same precedence: an explicit
    // per-call override first, then config.json, then whatever the session was
    // pinned to at start. These used to disagree — provider preferred config
    // while model preferred the session — so editing config.json mid-session
    // could switch the provider while leaving the model behind, producing
    // mismatched pairs like provider "openai" with model "MiniMax-M3".
    const config = readConfig();
    const currentProvider = config.current?.provider || session.provider;
    if (!currentProvider) {
      throw new Error(
        "No provider configured. Set current.provider in ~/.freecode/config.json.",
      );
    }

    // Keep the session's pin in step with an explicit override so meta.json
    // and telemetry record the model actually used.
    if (model) {
      session.model = model;
    }
    const currentModel = model || config.current?.model || session.model;
    if (effort) {
      session.effort = effort;
    }
    const currentEffort = effort || session.effort;

    // Update session with agentMode if provided
    if (paramAgentMode) {
      (session as unknown as Record<string, unknown>).agentMode =
        paramAgentMode;
    }

    // Get agentMode from session (set during session.start or updated above)
    const agentMode = (session as unknown as Record<string, unknown>)
      .agentMode as
      | "plan"
      | "build"
      | "review"
      | "explore"
      | "danger"
      | undefined;

    logger.info("Session send", {
      sessionId,
      messageLength: message.length,
      model: currentModel,
      provider: currentProvider,
      agentMode,
    });

    // First turn for this prompt — the loop's finally drains the queue when
    // this run finishes, so the FIFO drain re-enters through runSessionTurn
    // rather than recursively calling session.send (which would re-enter the
    // JSON-RPC layer).
    return runSessionTurn(session, {
      prompt: message,
      images,
      provider: currentProvider,
      model: currentModel,
      effort: currentEffort,
      agentMode,
    });
  },

  "session.stop": async (params: Record<string, unknown>): Promise<void> => {
    const { sessionId } = params as { sessionId: string };
    // Abort the in-flight turn (provider stream + tools). The session mapping is
    // kept so the conversation stays continuable — a Ctrl+C that cancels a turn
    // must not drop the session out from under the next message. In-memory
    // sessions are freed on process exit or explicit session.delete/archive.
    activeLoops.get(sessionId)?.interrupt();
    if (getSession(sessionId)) {
      logger.info("Session turn interrupted", { sessionId });
    }
  },

  // Remove a queued follow-up message by id. Used by the TUI for "drop" and
  // "restore to editor" affordances (spec 2026-08-05). No-op when the id has
  // already started sending — the resulting `message_dequeued` event lets the
  // UI distinguish "drop the indicator" from "ignore, message already in flight".
  // We always emit the event either way so web/SSE listeners stay in lockstep
  // with the TUI's response.
  "session.dequeue": async (
    params: Record<string, unknown>,
  ): Promise<{ removed: boolean }> => {
    const { sessionId, id } = params as { sessionId: string; id: string };
    const removed = messageQueues.get(sessionId)?.removeById(id) ?? false;
    BusEvents.stream(sessionId, {
      type: "message_dequeued",
      id,
    });
    return { removed };
  },

  // Manual /compact: summarize older turns now (between turns), trimming the
  // session store so the next turn sends fewer tokens. Emits the same
  // compaction UI events as auto-compaction.
  "session.compact": async (
    params: Record<string, unknown>,
  ): Promise<unknown> => {
    const { sessionId } = params as { sessionId: string };
    const session = getSession(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    const config = readConfig();
    const provider = config.current?.provider || session.provider;
    const model = config.current?.model || session.model;
    const store = await getSessionStore();
    const memory = new MemoryService(sessionId);

    let compactOptions = {};
    try {
      const aiProvider = getProvider(provider as ProviderId);
      compactOptions = { llmSummarize: createLlmSummarizer(aiProvider, model) };
    } catch {
      // No provider configured — fall back to the heuristic summary.
    }

    BusEvents.stream(sessionId, {
      type: "compaction_start",
      trigger: "manual",
    });
    const outcome = await applyCompaction({
      memory,
      store,
      sessionId,
      projectPath: session.projectPath,
      compactOptions,
    });
    BusEvents.stream(sessionId, {
      type: "compaction_complete",
      trigger: "manual",
      compacted: outcome.compacted,
      tokensBefore: outcome.tokensBefore,
      tokensAfter: outcome.tokensAfter,
      reason: outcome.reason,
    });

    logger.info("Session compacted", { sessionId, ...outcome });
    return {
      compacted: outcome.compacted,
      tokensBefore: outcome.tokensBefore,
      tokensAfter: outcome.tokensAfter,
      reason: outcome.reason,
    };
  },

  // Where the context window is going, by category (the `/context` command).
  // No provider call and no memory retrieval. It does take the session's frozen
  // project context, which snapshots the file tree if the session hasn't sent a
  // turn yet — the same snapshot that turn would have taken moments later.
  "context.stats": async (
    params: Record<string, unknown>,
  ): Promise<unknown> => {
    const { sessionId } = params as { sessionId: string };
    const session = getSession(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    const config = readConfig();
    const store = await getSessionStore();
    return await buildContextBreakdown({
      sessionId,
      projectPath: session.projectPath,
      provider: config.current?.provider || session.provider,
      model: config.current?.model || session.model,
      // Mode changes the mode-prompt section; it is persisted, not on SessionInfo.
      agentMode: getLastAgentMode() as AgentMode | undefined,
      messages: await store.getMessages(sessionId, session.projectPath),
    });
  },

  "question.answer": async (params: Record<string, unknown>): Promise<void> => {
    const { requestId, answers } = params as {
      requestId: string;
      answers: string[];
    };
    if (!answerQuestion(requestId, answers)) {
      // Another device (or the timeout) already closed this request. Tell
      // the caller explicitly rather than report success for an answer that
      // was discarded — silent success on a dropped answer is materially
      // worse than an error (spec §4.4). Frontends render -32002 as state,
      // not failure ("Already answered on another device").
      throw new JsonRpcError(
        REQUEST_ALREADY_RESOLVED,
        "Request already resolved",
      );
    }
  },

  "question.reject": async (params: Record<string, unknown>): Promise<void> => {
    const { requestId } = params as { requestId: string };
    if (!rejectQuestion(requestId)) {
      throw new JsonRpcError(
        REQUEST_ALREADY_RESOLVED,
        "Request already resolved",
      );
    }
  },

  "permission.answer": async (
    params: Record<string, unknown>,
  ): Promise<void> => {
    const { requestId, decision, editedRule } = params as {
      requestId: string;
      decision: PermissionAnswer["decision"];
      editedRule?: string;
    };
    if (!answerPermission(requestId, { decision, editedRule })) {
      throw new JsonRpcError(
        REQUEST_ALREADY_RESOLVED,
        "Request already resolved",
      );
    }
  },

  "permission.reject": async (
    params: Record<string, unknown>,
  ): Promise<void> => {
    const { requestId } = params as { requestId: string };
    if (!rejectPermission(requestId)) {
      throw new JsonRpcError(
        REQUEST_ALREADY_RESOLVED,
        "Request already resolved",
      );
    }
  },

  "providers.list": async (
    params: Record<string, unknown>,
  ): Promise<unknown[]> => {
    // `kind` splits the two pickers: /model lists metered APIs, /web lists
    // browser sessions. Absent means both, which is what every existing caller
    // sends and what the VS Code and desktop shells still expect.
    const { kind } = (params ?? {}) as { kind?: "api" | "web" };

    // models.dev names more providers than freecode can construct — the ones
    // whose SDK needs a credential loader rather than an API key (Bedrock,
    // Vertex, Azure, watsonx, …). Offering those here is what produced
    // `Provider "x" not registered` at send time, on a provider the picker
    // itself invited the user to choose. The registry is the authority on what
    // can actually run, so filter to it rather than listing the catalogue raw.
    // Awaited, not assumed: registration is async (it imports the catalogue
    // and the generic driver), and reading the registry before it finishes
    // filters the entire catalogue away — an empty model picker rather than a
    // wrong one. `initProviders` is memoized, so this is free once it has run.
    await initProviders();
    const constructible = new Set(listProviders().map((p) => p.id));
    const api =
      kind === "web"
        ? []
        : (await getProviders()).filter((p) => constructible.has(p.id));
    const web = kind === "api" ? [] : LOCAL_PROVIDERS;

    return [
      ...api.map((p) => ({
        id: p.id,
        name: p.name,
        description: p.description,
        kind: "api" as const,
        status: hasApiKey(p.id as ProviderId) ? "configured" : "needs-setup",
        hasApiKey: hasApiKey(p.id as ProviderId),
      })),
      ...web.map((p) => {
        const stored = hasWebCredential(p.id);
        // Four states, not a boolean. A session that authenticates anonymously
        // is READY with nothing on file, and calling that "not configured"
        // is a lie about the only provider that works out of the box.
        const status = providerRequiresApiKey(p.id as ProviderId)
          ? stored
            ? "configured"
            : "needs-setup"
          : stored
            ? "signed-in"
            : "ready";
        return {
          id: p.id,
          name: p.name,
          description: p.description,
          kind: "web" as const,
          status,
          credential: p.credential,
          // Retained for the shells that still read a boolean. "Can this be
          // selected right now" is the question it was always answering.
          hasApiKey: status !== "needs-setup",
        };
      }),
    ];
  },

  "models.list": async (
    params: Record<string, unknown>,
  ): Promise<unknown[]> => {
    const { providerId } = params as { providerId: string };
    const local = localProvider(providerId);
    if (local) return local.models;
    return getProviderModels(providerId);
  },

  "models.contextLimit": async (
    params: Record<string, unknown>,
  ): Promise<number> => {
    const { provider, model } = params as { provider: string; model: string };
    return getModelContextLimit(provider, model);
  },

  "usage.get": async (): Promise<unknown[]> => {
    return readDailyUsage();
  },

  // Persisted prompt history for up-arrow recall. Core owns
  // ~/.freecode/history.jsonl; the editor's in-memory ring is seeded at
  // startup and appended on every submit.
  "history.list": async (): Promise<string[]> => {
    return readHistoryDisplays();
  },
  "history.append": async (
    params: Record<string, unknown>,
  ): Promise<void> => {
    const { text } = params as { text: string };
    appendHistory(text);
  },

  "skills.list": async (
    params: Record<string, unknown>,
  ): Promise<{ name: string; description?: string; scope: string }[]> => {
    const { projectPath } = params as { projectPath?: string };
    const manager = getSkillsManagerForProject(projectPath || process.cwd());
    const skills = await manager.listSkills();
    return skills.map((s) => ({
      name: s.name,
      description: s.description,
      scope: s.scope,
    }));
  },

  "mcp.status": async (
    params: Record<string, unknown>,
  ): Promise<
    {
      name: string;
      type: string;
      enabled: boolean;
      status: "connected" | "disconnected";
      toolCount: number;
      tools: string[];
    }[]
  > => {
    const { name } = params as { name?: string };
    const config = await import("./mcp/config.js").then((m) =>
      m.loadMcpConfig(getConfigDir()),
    );
    const connectedServers = listClients();
    const mcpTools = getMcpTools();

    const servers = name
      ? config.servers.filter((s) => s.name === name)
      : config.servers;

    return servers.map((server) => {
      const isConnected = connectedServers.includes(server.name);
      const serverTools = Object.values(mcpTools).filter(
        (t: any) => t.id && t.id.startsWith(`mcp__${server.name}__`),
      );
      return {
        name: server.name,
        type: server.type,
        enabled: server.enabled,
        status: isConnected ? "connected" : "disconnected",
        toolCount: serverTools.length,
        tools: serverTools.map((t: any) => t.id),
      };
    });
  },

  "commands.list": async (
    params: Record<string, unknown>,
  ): Promise<unknown[]> => {
    const { projectPath } = params as { projectPath?: string };
    return listCommandInfos(projectPath || process.cwd());
  },

  "commands.resolve": async (
    params: Record<string, unknown>,
  ): Promise<{ prompt: string }> => {
    const { name, args, projectPath } = params as {
      name: string;
      args?: string[];
      projectPath?: string;
    };
    const cwd = projectPath || process.cwd();
    const prompt = await resolveCommand(name, args ?? [], cwd, cwd);
    if (prompt == null) {
      throw new Error(`Command not found: ${name}`);
    }
    return { prompt };
  },

  // Redacted, not raw: this is reachable over `web-server.ts`'s POST /api,
  // whose `host` is a parameter — one `--host 0.0.0.0` would otherwise turn a
  // debug convenience into key exfiltration. No caller ever wanted the key
  // itself; `hasApiKey` is the question they were all asking.
  "config.get": async (): Promise<unknown> => {
    return redactConfig();
  },

  "config.setApiKey": async (
    params: Record<string, unknown>,
  ): Promise<void> => {
    const { provider, apiKey, model } = params as {
      provider: string;
      apiKey: string;
      model?: string;
    };
    setApiKey(provider as ProviderId, apiKey, model);
  },

  "config.setWebCredential": async (
    params: Record<string, unknown>,
  ): Promise<void> => {
    const { provider, credential } = params as {
      provider: string;
      credential: WebCredentials;
    };
    setWebCredential(provider, credential);
  },

  "config.setCurrentModel": async (
    params: Record<string, unknown>,
  ): Promise<void> => {
    const { provider, model } = params as { provider: string; model: string };
    setCurrentModel(provider, model);
  },

  "config.getCurrentModel": async (): Promise<unknown> => {
    return getCurrentModel();
  },

  "config.getLastAgentMode": async (): Promise<unknown> => {
    return getLastAgentMode();
  },

  "config.setLastAgentMode": async (
    params: Record<string, unknown>,
  ): Promise<void> => {
    const { mode } = params as { mode: string };
    setLastAgentMode(mode);
  },

  // ========== Memory Methods ==========

  "memory.list": async (
    params: Record<string, unknown>,
  ): Promise<MemoryEntry[]> => {
    const { projectPath, type } = params as {
      projectPath?: string;
      type?: MemoryType;
    };
    const store = getMemoryStore(projectPath || process.cwd());
    return store.list(type);
  },

  "memory.get": async (
    params: Record<string, unknown>,
  ): Promise<MemoryEntry | null> => {
    const { name, type, projectPath } = params as {
      name: string;
      type: MemoryType;
      projectPath?: string;
    };
    const store = getMemoryStore(projectPath || process.cwd());
    return store.load(name, type) || null;
  },

  "memory.save": async (params: Record<string, unknown>): Promise<void> => {
    const { entry, projectPath } = params as {
      entry: MemoryEntry;
      projectPath?: string;
    };
    const store = getMemoryStore(projectPath || process.cwd());
    store.save(entry);
  },

  "memory.delete": async (
    params: Record<string, unknown>,
  ): Promise<boolean> => {
    const { name, type, projectPath } = params as {
      name: string;
      type: MemoryType;
      projectPath?: string;
    };
    const store = getMemoryStore(projectPath || process.cwd());
    return store.delete(name, type);
  },

  "memory.query": async (
    params: Record<string, unknown>,
  ): Promise<MemoryEntry[]> => {
    const { query, projectPath, limit, types } = params as {
      query: string;
      projectPath?: string;
      limit?: number;
      types?: MemoryType[];
    };
    // Route through the graph service: semantic top-k + cascade, with the
    // keyword scorer as the built-in fallback when embeddings are unavailable.
    const service = getMemoryGraphService(projectPath || process.cwd());
    return service.retrieve(query, { limit, types });
  },

  "memory.graph.rebuild": async (
    params: Record<string, unknown>,
  ): Promise<ReturnType<ReturnType<typeof getMemoryGraphService>["stats"]>> => {
    const { projectPath } = params as { projectPath?: string };
    const service = getMemoryGraphService(projectPath || process.cwd());
    await service.rebuild();
    return service.stats();
  },

  "memory.graph.stats": async (
    params: Record<string, unknown>,
  ): Promise<ReturnType<ReturnType<typeof getMemoryGraphService>["stats"]>> => {
    const { projectPath } = params as { projectPath?: string };
    const service = getMemoryGraphService(projectPath || process.cwd());
    return service.stats();
  },

  // Open the optional graph explorer in the browser. The addon is a
  // separate download (see cli/commands/memory/ui.ts); if it's not
  // installed, return { error: "not-installed" } so the TUI can print the
  // install instructions instead of starting a server that has nothing to
  // serve.
  "graph.explore": async (): Promise<
    { url: string } | { error: "not-installed" }
  > => {
    const service = getMemoryGraphService(process.cwd());
    return startGraphExplorer(service, { openBrowser });
  },

  // Full (non-relevance) memory block. For relevance-ranked retrieval use
  // memory.query, which routes through the graph service.
  "memory.buildPrompt": async (
    params: Record<string, unknown>,
  ): Promise<string> => {
    const { projectPath, types, limit, all } = params as {
      projectPath?: string;
      types?: MemoryType[];
      limit?: number;
      all?: boolean;
    };
    const store = getMemoryStore(projectPath || process.cwd());
    return buildMemoryPrompt(store, { types, limit, all });
  },

  // ========== Session Methods ==========

  "session.list": async (
    params: Record<string, unknown>,
  ): Promise<SessionContext[]> => {
    const { projectPath, status } = params as {
      projectPath?: string;
      status?: "active" | "archived" | "deleted";
    };
    const manager = await getSessionManager();
    return manager.list({ projectPath, status });
  },

  "session.resume": async (
    params: Record<string, unknown>,
  ): Promise<unknown> => {
    const { sessionId } = params as { sessionId: string };
    const manager = await getSessionManager();
    const context = await manager.resume(sessionId);

    // Store in-memory session mapping so that subsequent session.send requests can find it.
    // Seeded from config the same way createSession is, so a resumed session
    // isn't left model-less and reliant on the provider's default.
    const resumeCurrent = readConfig().current;
    const resumeProvider = context.provider || resumeCurrent?.provider;
    if (!resumeProvider) {
      throw new Error(
        `Session ${context.id} has no provider and none is configured. ` +
          "Set current.provider in ~/.freecode/config.json.",
      );
    }
    const session: SessionInfo = {
      id: context.id,
      projectPath: context.projectPath,
      provider: resumeProvider,
      model: context.model || resumeCurrent?.model,
    };
    // Initialize default agent mode
    (session as unknown as Record<string, unknown>).agentMode = "build";
    sessions.set(context.id, session);

    // Return shape the TUI client expects: { sessionId, messages }
    return {
      sessionId: context.id,
      messages: context.messages,
    };
  },

  // Claude Code session discovery. Read-only — we never write back to the
  // user's ~/.claude. The picker shows these as a second tab in /resume
  // (see docs/superpowers/specs/2026-08-02-resume-modal-claude-code-tab.md).
  "session.claudeList": async (
    params: Record<string, unknown>,
  ): Promise<ClaudeSessionMeta[]> => {
    const { projectPath, limit } = params as {
      projectPath?: string;
      limit?: number;
    };
    return listClaudeSessions({ projectPath, limit });
  },

  "session.claudeTranscript": async (
    params: Record<string, unknown>,
  ): Promise<ClaudeTranscript> => {
    const { sessionId } = params as { sessionId: string };
    const messages = await readClaudeTranscript(sessionId);
    return { sessionId, messages };
  },

  "session.switch": async (params: Record<string, unknown>): Promise<void> => {
    const { sessionId } = params as { sessionId: string };
    const manager = await getSessionManager();
    // The session being switched *away from* is the one that ended (D3). Its
    // six per-session caches used to leak on every switch.
    const leaving = (await manager.getCurrent())?.id;
    await manager.switch(sessionId);
    if (leaving && leaving !== sessionId) {
      await endSessionOnce(leaving, "switch");
    }
  },

  "session.fork": async (params: Record<string, unknown>): Promise<string> => {
    const { sessionId } = params as { sessionId: string };
    const manager = await getSessionManager();
    return manager.fork(sessionId);
  },

  "session.archive": async (params: Record<string, unknown>): Promise<void> => {
    const { sessionId } = params as { sessionId: string };
    const manager = await getSessionManager();
    await manager.archive(sessionId);
    await endSessionOnce(sessionId, "archive");
  },

  "session.delete": async (params: Record<string, unknown>): Promise<void> => {
    const { sessionId, purge } = params as {
      sessionId: string;
      purge?: boolean;
    };
    const manager = await getSessionManager();
    await manager.delete(sessionId, purge);
    // No flush: the user discarded this session, so mining it for memories is
    // the one case where a write is clearly unwanted. The disposers still run,
    // including the follow-up queue, which would otherwise leak pending
    // prompts and drain them into a turn for a session that no longer exists.
    await endSessionOnce(sessionId, "delete", { flush: false });
  },

  "session.getInterrupted": async (): Promise<{
    sessionId: string;
    messageId: string;
  } | null> => {
    const store = await getSessionStore();
    return store.getInterruptedSession();
  },

  // ========== Remote Sync Methods ==========

  "session.export": async (
    params: Record<string, unknown>,
  ): Promise<ExportedSession> => {
    const { sessionId } = params as { sessionId: string };
    const remoteSync = await getRemoteSync();
    return remoteSync.exportSession(sessionId);
  },

  "session.import": async (
    params: Record<string, unknown>,
  ): Promise<{ sessionId: string }> => {
    const { url } = params as { url: string };
    const manager = await getSessionManager();
    const sessionId = await manager.import(url);
    return { sessionId };
  },

  "session.upload": async (
    params: Record<string, unknown>,
  ): Promise<string> => {
    const { sessionId, endpoint, apiKey } = params as {
      sessionId: string;
      endpoint: string;
      apiKey?: string;
    };
    const remoteSync = await getRemoteSync();
    return remoteSync.upload(sessionId, { endpoint, apiKey });
  },

  "session.download": async (
    params: Record<string, unknown>,
  ): Promise<string> => {
    const { url, endpoint, apiKey } = params as {
      url: string;
      endpoint?: string;
      apiKey?: string;
    };
    const remoteSync = await getRemoteSync();
    return remoteSync.download(url, { endpoint: endpoint || url, apiKey });
  },
};

export async function handleRequest(
  request: JsonRpcRequest,
): Promise<JsonRpcResponse> {
  try {
    const handler = methodHandlers[request.method];
    if (!handler) {
      return createError(
        request.id,
        -32601,
        `Method not found: ${request.method}`,
      );
    }
    const result = await handler(request.params ?? {});
    return createResponse(request.id, result);
  } catch (error) {
    if (error instanceof JsonRpcError) {
      // Carries a domain-specific error code (e.g. -32002 for already-resolved
      // prompts) that the generic -32603 would otherwise hide.
      return createError(request.id, error.code, error.message);
    }
    const message = error instanceof Error ? error.message : String(error);
    return createError(request.id, -32603, message);
  }
}

// In the compiled binary the "run if executed directly" guard below matches
// (import.meta.url and argv[1] both resolve to the bunfs entry path), so the
// `serve` command would start the server a second time — double stdin
// listeners, every request handled twice. Idempotency flag makes any second
// call a no-op.
let serverStarted = false;

// Last-resort net for a provider/effect error that escapes every try/catch in
// the turn path (see cli.ts's matching handler — this is the same fault,
// caught here too so the *session* recovers, not just the terminal output).
// cli.ts's handler only stops the raw dump; it has no way to know which
// session was mid-turn when the fault hit, so that session's activeLoops
// entry would otherwise sit forever and its session.send promise would never
// resolve. Walk every in-flight loop, abort it, and surface a clean
// session.error so the frontend shows a failure instead of a stuck spinner.
function handleEscapedProviderError(kind: string, error: unknown): void {
  const message = formatFatalError(error);
  logger.error(`[Server] ${kind} escaped the turn path: ${message}`);
  for (const [sessionId, loop] of [...activeLoops]) {
    try {
      loop.interrupt();
    } catch {
      // Loop already gone or mid-teardown — nothing to abort.
    }
    BusEvents.sessionError(sessionId, message);
    activeLoops.delete(sessionId);
  }
}

export async function startServer() {
  if (serverStarted) return;
  serverStarted = true;

  // Registered once, for the life of the daemon: same rationale as cli.ts's
  // handlers, but scoped to also clean up whichever session was in flight.
  process.on("uncaughtException", (e) =>
    handleEscapedProviderError("uncaughtException", e),
  );
  process.on("unhandledRejection", (e) =>
    handleEscapedProviderError("unhandledRejection", e),
  );

  await initProviders();
  await initMcpServers();

  // Built-in hooks + settings.json hooks (project + user scopes). Shared with
  // `freecode run` so headless and served runs load the same hooks.
  const hookSettings = initHooks(process.cwd(), { watch: true });

  // Clean up on shutdown. `exit` cannot await, so the memory flush goes on the
  // signal handlers, which can (spec D3/D4) — quitting is how most sessions
  // actually end, and it was the path that mined nothing and leaked all six
  // per-session caches.
  process.on("exit", () => hookSettings.dispose());

  let shuttingDown = false;
  const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    // Abort in-flight provider/tool calls first: the flush below reads the
    // persisted transcript, so waiting for a turn to finish buys nothing and
    // delays the exit.
    for (const loop of activeLoops.values()) loop.interrupt();
    await Promise.all(
      [...sessions.keys()].map((id) =>
        endSessionOnce(id, "exit").catch(() => {
          // endSession already swallows; this guards the promise itself. A
          // cleanup failure must never stop the process from exiting.
        }),
      ),
    );
    hookSettings.dispose();
    process.exit(signal === "SIGINT" ? 130 : 143);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  // Speaker wire: forward internal bus events to both frontend transports.
  bus.subscribeAll((event) => {
    const wire = busEventToClientEvent(event);
    if (!wire) return;
    const line = JSON.stringify(wire) + "\n";
    process.stdout.write(line); // TUI reads stdout lines
    // Web SSE: route to the owning session if known, else broadcast to all
    // sessions (preserves the previous "no sessionId ⇒ fan-out" behavior).
    const sid = (event as { sessionId?: string }).sessionId;
    if (sid) {
      publishToSession(sid, wire);
    } else {
      publishToAll(wire);
    }
  });

  // Set up Ctrl+C interrupt handler for session resumption
  const handler = getInterruptHandler();
  handler.setupSignalHandler(async (sessionId: string, messageId: string) => {
    // Abort the in-flight provider/tool work first so the process is idle
    activeLoops.get(sessionId)?.interrupt();
    try {
      const manager = await getSessionManager();
      await manager.markInterrupted(sessionId, messageId);
    } catch (e) {
      // Ignore errors during interrupt handling
    }
  });

  let buffer = "";

  process.stdin.setEncoding("utf-8");

  const dispatchRequest = (request: JsonRpcRequest): void => {
    void handleRequest(request)
      .then((response) => {
        process.stdout.write(JSON.stringify(response) + "\n");
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        process.stderr.write(`Request error: ${message}\n`);
      });
  };

  process.stdin.on("data", (chunk: string) => {
    buffer += chunk;

    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        dispatchRequest(JSON.parse(line) as JsonRpcRequest);
      } catch (e) {
        const error = e instanceof Error ? e.message : String(e);
        process.stderr.write(`Parse error: ${error}\n`);
      }
    }
  });

  process.stdin.on("end", () => {
    if (buffer.trim()) {
      try {
        dispatchRequest(JSON.parse(buffer) as JsonRpcRequest);
      } catch (e) {
        process.stderr.write(`Final parse error: ${e}\n`);
      }
    }
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startServer().catch((e) => {
    process.stderr.write(`Server error: ${e}\n`);
    process.exit(1);
  });
}
