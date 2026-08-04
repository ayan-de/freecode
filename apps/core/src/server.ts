// =============================================================================
// JSON-RPC Server — CLI Backend
// Handles tools.list, tools.call, session.start, session.send, session.stop, providers.list
// =============================================================================

import { getTool, listTools } from "./tools/index.js";
import { listCommandInfos, resolveCommand } from "./commands/registry.js";
import { createAgentLoopEffect, type AgentLoop } from "./agent/loop.js";
import { getAppRuntime } from "./effect/runtime.js";
import { SessionStoreTag } from "./effect/context.js";
import {
  initProviders,
  listProviders,
  getProvider,
} from "./providers/index.js";
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
  writeConfig,
  setApiKey,
  setCurrentModel,
  hasApiKey,
  getCurrentModel,
  getLastAgentMode,
  setLastAgentMode,
  type ProviderId,
} from "./providers/config.js";
import { logger } from "./utils/logger.js";
import type { ToolContext } from "./tools/types.js";
import type {
  JsonRpcRequest,
  JsonRpcResponse,
  SessionConfig,
} from "@thisisayande/freecode-shared";
import {
  getMemoryStore,
  getMemoryGraphService,
  disposeSessionMemory,
  type MemoryEntry,
  type MemoryType,
} from "./memory/index.js";
import { buildMemoryPrompt } from "./memory/mem-prompt.js";
import { disposeOutputStore } from "./tools/output-store/index.js";
import { disposeCacheAwareness } from "./providers/cache-awareness.js";
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
import { registerRtkHook } from "./hooks/builtin/rtk-rewrite.js";
import { HookSettingsManager } from "./hooks/settings.js";
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
}

export const sessions: Map<string, SessionInfo> = new Map();
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
  };
  sessions.set(id, session);
  return session;
}

function getSession(id: string): SessionInfo | undefined {
  return sessions.get(id);
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

const methodHandlers: Record<
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
      agentMode: paramAgentMode,
      images,
    } = params as {
      sessionId: string;
      message: string;
      model?: string;
      agentMode?: string;
      images?: Array<{ data: string; mediaType: string; altText?: string }>;
    };
    const session = getSession(sessionId);

    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
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

    // Get session store for persisting messages
    const store = await getSessionStore();

    // Construct the loop through the Effect runtime — memory, hooks, recorder,
    // orchestrator and session store are all DI-provided (v3 spec).
    const loop = await getAppRuntime().runPromise(
      createAgentLoopEffect(sessionId, { maxIterations: 250 }),
    );
    activeLoops.set(sessionId, loop);
    let result;
    try {
      result = await getAppRuntime().runPromise(
        loop.runEffect({
          prompt: message,
          sessionId,
          provider: currentProvider,
          model: currentModel,
          projectPath: session.projectPath,
          agentMode,
          images,
        }),
      );
    } finally {
      activeLoops.delete(sessionId);
    }

    // Emit done event through the single bus egress
    BusEvents.stream(sessionId, {
      type: "done",
      content: result.message || "Done",
    });

    // Extract session title from first response (no extra API call)
    if (result.success && result.turnCount > 0 && result.content) {
      const titleMatch = result.content.match(/SESSION_TITLE:\s*(.+)/i);
      const title = titleMatch
        ? titleMatch[1].trim()
        : generateTitleFromPrompt(message);
      await store.updateMeta(sessionId, { title }, session.projectPath);
    }

    return result;
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

  "providers.list": async (): Promise<unknown[]> => {
    const providers = await getProviders();
    return providers.map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      hasApiKey: hasApiKey(p.id as ProviderId),
    }));
  },

  "models.list": async (
    params: Record<string, unknown>,
  ): Promise<unknown[]> => {
    const { providerId } = params as { providerId: string };
    const models = await getProviderModels(providerId);
    return models;
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

  "config.get": async (): Promise<unknown> => {
    return readConfig();
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
    await manager.switch(sessionId);
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
  },

  "session.delete": async (params: Record<string, unknown>): Promise<void> => {
    const { sessionId } = params as { sessionId: string };
    const manager = await getSessionManager();
    await manager.delete(sessionId);
    disposeSessionMemory(sessionId);
    disposeOutputStore(sessionId);
    disposeCacheAwareness(sessionId);
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

export async function startServer() {
  if (serverStarted) return;
  serverStarted = true;
  await initProviders();
  await initMcpServers();

  // Optional rtk integration: rewrites bash commands to compact `rtk`
  // equivalents to save tokens. No-op unless rtk resolves; FREECODE_RTK=0 opts out.
  registerRtkHook();

  // Load hooks from settings.json (project + user scopes)
  const hookSettings = new HookSettingsManager(process.cwd());
  hookSettings.load();
  hookSettings.watch();

  // Clean up on shutdown
  process.on("exit", () => hookSettings.dispose());

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
