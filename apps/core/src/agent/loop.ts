// =============================================================================
// Agent Loop - Continuous Loop (Claude Code style)
// PRIMARY: Main execution engine for the agent
// INPUT: UserInput { prompt, sessionId, provider, projectPath }
// OUTPUT: LoopResult { success, message, turnCount, iterationCount, finalState }
// FLOW: Build Prompt → Send to AI → Normalize → Parse → Execute Tool → Loop
//
// ARCHITECTURE: Single LLM call per turn (like Claude Code/OpenCode)
//   - Pre-build git context once per turn
//   - Include file tree and memory in prompt
//   - Model decides which tools to use via function calling
// =============================================================================

import * as path from "path";
import * as os from "os";
import { randomUUID } from "crypto";
import type {
  SessionState,
  ToolCall,
  ToolResult,
  Message,
  MessagePart,
  LoopHeuristics,
  UserInput,
  LoopResult,
  AssistantContent,
  HookContext,
  AgentMode,
} from "./types.js";
import type { SystemBlock } from "../providers/types.js";
import type { PermissionRequestResult } from "../hooks/PermissionRequest.js";
import { evaluatePermission } from "../permission/evaluate.js";
import { promptForPermission } from "../permission/prompt.js";
import { PermissionSettingsManager } from "../permission/settings.js";
import { createInitialSessionState, DEFAULT_LOOP_HEURISTICS } from "./types.js";
import {
  isRevert,
  toEditTransition,
  RECENT_EDIT_WINDOW,
  type EditTransition,
} from "./oscillation.js";
import { logger } from "../utils/logger.js";
import { Effect } from "effect";
import { createToolOrchestrator, getTool } from "../tools/index.js";
import { renderTodoPromptBlock } from "../tools/todo.js";
import {
  evaluateTodoGate,
  shouldNudgeTodo,
  todoNudgeReminder,
  TODO_GATE_MAX_FORCES,
} from "./reminders.js";
import {
  resolveVerifyCommand,
  runVerify,
  verifyFailureReminder,
  MAX_VERIFY_ATTEMPTS,
} from "./verify.js";
import {
  verifyChanges,
  verifierFailureReminder,
  VERIFIER_MIN_FILES,
  MAX_VERIFIER_ATTEMPTS,
} from "./subagent.js";
import type { ToolOrchestrator } from "../tools/orchestrator.js";
import { getToolDefs } from "../tools/defs-cache.js";
import { planToolBatches } from "../tools/batching.js";
import { markReadPruned } from "../tools/read-state.js";
import { PruneState, type PruneCandidate } from "./prune-state.js";
import { applySystemPromptHookRewrite } from "./apply-system-hook.js";
import { getFrozenSessionContext } from "../context/session-context.js";
import { ensureWatching } from "../context/tree-watcher.js";
import { MemoryService } from "../compaction/index.js";
import { getMaxTurnTokens } from "../compaction/tokens.js";
import { getMemoryGraphService } from "../memory/graph/index.js";
import { renderRetrievedMemories } from "../memory/mem-prompt.js";
import { extractMemories } from "../memory/extract.js";
import { shouldExtract } from "../memory/extract-policy.js";
import { loadHarnessPromptBlock } from "../harness/inject.js";
import { createLlmSummarizer } from "../compaction/llm-summarizer.js";
import type { CompactOptions } from "../compaction/service.js";
import {
  applyCompaction,
  type ApplyCompactionResult,
} from "../session/compact-apply.js";
import {
  getModelContextLimit,
  modelSupportsImages,
  resolveMaxOutputTokens,
} from "../models-dev.js";
import { getProvider } from "../providers/index.js";
import { isPlainObject } from "../providers/utils.js";
import { recordInvalidation } from "../providers/cache-invalidation.js";
import {
  checkCacheUsage,
  describeCacheProblem,
  isCacheMissNoticesEnabled,
  bumpCacheGeneration,
} from "../providers/cache-miss.js";
import {
  noteSendAndCheckCold,
  summarizeCache,
} from "../providers/cache-awareness.js";
import { createHookRuntime, type HookRuntime } from "../hooks/runtime.js";
import type { HookResult } from "../agent/types.js";
import { bus, BusEvents } from "../bus/index.js";
import { createRecorder, type RolloutRecorder } from "../rollout/recorder.js";
import {
  type SessionStore,
  type SerializedMessage,
  type MessageUsage,
} from "../session/store.js";
import { getInterruptHandler } from "../session/interrupt.js";
import { recordDailyUsage } from "../usage/tracker.js";
import { PromptCompiler } from "../context/compiler.js";
import {
  HookRuntimeTag,
  ToolOrchestratorTag,
  SessionStoreTag,
  MemoryFactoryTag,
  RecorderFactoryTag,
  RecoveryManagerTag,
} from "../effect/context.js";
import {
  createRecoveryManagerFromConfig,
  isContextOverflowError,
  type RecoveryManager,
} from "./recovery/manager.js";

// =============================================================================
// AgentLoop Config
// All collaborators are injectable (Effect DI provides them via
// createAgentLoopEffect); constructor fallbacks keep direct construction
// working for tests and legacy call sites.
// =============================================================================

// How many times a single run may compact in response to the provider
// rejecting the request as too long. Each attempt is a full round trip, so an
// unbounded retry loop is expensive and, when compaction cannot free enough,
// never converges.
const MAX_OVERFLOW_COMPACTIONS = 3;

// Total chars of tool-result content the model may see across the whole
// history before the largest fresh results start being replaced with a marker.
//
// Scope note: claude-code's MAX_TOOL_RESULTS_PER_MESSAGE_CHARS is the same
// 200K but applies *per message* — it guards one turn's parallel batch, not the
// conversation. This is history-wide, because compaction here is what bounds
// the conversation and it now fires on a cost target (~107K tokens ≈ 428K
// chars). A 200K-char (~50K token) share for tool results leaves room for the
// rest of the context under that target.
const TOOL_RESULT_BUDGET_CHARS = Number.isFinite(
  Number(process.env.FREECODE_TOOL_RESULT_BUDGET_CHARS),
)
  ? Math.max(0, Number(process.env.FREECODE_TOOL_RESULT_BUDGET_CHARS))
  : 200_000;

// The marker that stands in for a replaced tool result. Deterministic in
// (id, size) so re-deriving it always yields the same bytes — though the
// recorded copy in PruneState is what is actually re-applied.
//
// The `output` handle only resolves while the session that produced the result
// is live; the store is in-memory and empty after a resume, where it degrades
// to the tool's unknown-id message. Hence "or re-run" rather than a promise.
function renderPrunedToolResult(id: string, size: number): string {
  return (
    `[tool result omitted to save context — ${size} chars. ` +
    `Retrieve with the \`output\` tool (id="${id}"), or re-run the tool.]`
  );
}

export interface AgentLoopConfig {
  maxIterations?: number;
  heuristics?: Partial<LoopHeuristics>;
  hooks?: HookRuntime;
  recorder?: RolloutRecorder;
  sessionStore?: SessionStore;
  memory?: MemoryService;
  orchestrator?: ToolOrchestrator;
  recovery?: RecoveryManager;
  /**
   * Mine the transcript for durable memories when the run completes.
   * Defaults to true. Subagents set it false: their transcript is delegated
   * machine work, not user conversation, and one extraction call per subagent
   * would multiply the cost of a single user turn.
   */
  memoryExtraction?: boolean;
}

// =============================================================================
// extractToolImage
// A tool signals "I produced an image" by putting { data, mediaType } under
// metadata.image, which the orchestrator forwards as structuredData.
// =============================================================================

function extractToolImage(
  result: ToolResult,
): { data: string; mediaType: string } | undefined {
  if (result.error) return undefined;
  const data = result.structuredData;
  if (!isPlainObject(data)) return undefined;
  const image = (data as Record<string, unknown>).image;
  if (!isPlainObject(image)) return undefined;
  const { data: b64, mediaType } = image as Record<string, unknown>;
  if (typeof b64 !== "string" || b64.length === 0) return undefined;
  if (typeof mediaType !== "string" || mediaType.length === 0) return undefined;
  return { data: b64, mediaType };
}

// =============================================================================
// AgentLoop Class
// Main entry point for continuous agent execution
// =============================================================================

export class AgentLoop {
  // ---------------------------------------------------------------------------
  // Private State
  // ---------------------------------------------------------------------------
  private state: SessionState;
  private history: Message[] = [];
  private config: { maxIterations: number; heuristics: LoopHeuristics };
  private memory: MemoryService;
  private hooks: HookRuntime;
  private recorder: RolloutRecorder;
  private orchestrator: ToolOrchestrator;
  private recovery: RecoveryManager;
  private memoryExtraction: boolean;
  private sessionStore: SessionStore | undefined;
  private lastThinking: string | undefined;
  private compiler: PromptCompiler;
  // Per-rule permission layer: project + user settings + session grants
  private permissionSettings: PermissionSettingsManager | undefined;
  // Cancellation: aborted on interrupt(); threaded into provider requests and
  // tool contexts so in-flight work stops, not just the next loop check.
  private abort = new AbortController();
  // Loop health tracking state
  private recentToolCalls: Array<{ tool: string; args: string }> = [];
  private recentReasoning: string[] = [];
  // Recent edit transitions, newest last — searched for inverses to spot reverts.
  private recentEdits: EditTransition[] = [];
  private fileStateHash: string = "";
  // Reminder state (Phase 2): transient <system-reminder> blocks drained into
  // the next turn's prompt, plus counters for the todo nudge/gate.
  private pendingReminders: string[] = [];
  private todoGateForces = 0;
  private turnsSinceTodoWrite = 0;
  // Did the model save a memory itself during this run? If so, extraction is
  // skipped — it has already said what it wanted to keep.
  private memoryToolUsedThisRun = false;
  private turnsSinceLastNudge = 0;
  // The provider's own count of the last request's input (prompt + cache
  // reads + cache writes) — i.e. how full the model's window actually is.
  // Drives auto-compaction, which previously read MemoryService's estimate
  // and so missed everything tool calls contributed. 0 until the first
  // response carries usage.
  private lastMeasuredContextTokens = 0;
  // Compactions triggered by a provider rejecting the request as too long.
  // Reset on any successful send; capped so a conversation that cannot be
  // shrunk enough fails once instead of retrying forever.
  private overflowCompactions = 0;
  // Verification gate state: whether this run mutated files (so verify is
  // worth running) and how many times the gate has run.
  private filesMutatedThisRun = false;
  private verifyAttempts = 0;
  // Distinct files edited/written this run + verifier-subagent attempt count,
  // driving the adversarial verification gate for non-trivial changes.
  private mutatedFiles = new Set<string>();
  private verifierAttempts = 0;
  private lastVerifierReport: string | undefined;
  // Memory graph cache: skip expensive graph re-query when the user text
  // hasn't changed (back-to-back tool turns triggered by one message).
  private lastMemoryQueryText: string = "";
  private lastMemoryBlock: string | undefined = undefined;
  // Which tool results have gone to the provider, and how, so the cached
  // prompt prefix stays byte-stable across the turns of this run.
  private readonly pruneState = new PruneState();

  constructor(sessionId: string, config?: AgentLoopConfig) {
    this.state = createInitialSessionState(sessionId, ""); // projectPath set in run()
    this.config = {
      maxIterations: config?.maxIterations ?? 250,
      heuristics: { ...DEFAULT_LOOP_HEURISTICS, ...config?.heuristics },
    };
    this.memory = config?.memory ?? new MemoryService(sessionId);
    this.hooks = config?.hooks ?? createHookRuntime();
    this.recorder = config?.recorder ?? createRecorder(sessionId);
    this.orchestrator = config?.orchestrator ?? createToolOrchestrator();
    this.recovery = config?.recovery ?? createRecoveryManagerFromConfig();
    this.compiler = new PromptCompiler("", "");
    this.sessionStore = config?.sessionStore;
    this.memoryExtraction = config?.memoryExtraction ?? true;
  }

  private async loadHistory(): Promise<void> {
    if (!this.sessionStore) {
      this.history = [];
      return;
    }

    await this.ensureProjectPath();
    try {
      const serialized = await this.sessionStore.getMessages(
        this.state.sessionId,
        this.state.projectPath,
      );
      this.history = serialized.map((msg): Message => {
        return {
          id: msg.id,
          role: msg.role,
          timestamp: msg.timestamp,
          parts: msg.parts.map((part, partIndex): MessagePart => {
            if (part.type === "text") {
              return { type: "text", content: part.content || "" };
            } else if (part.type === "code") {
              return {
                type: "code",
                language: part.language || "",
                content: part.content || "",
              };
            } else if (part.type === "image") {
              return {
                type: "image",
                data: part.data || "",
                mediaType: part.mediaType || "image/png",
                altText: part.altText,
              };
            } else {
              const toolCall: ToolCall = {
                // The provider's original tool_use id is not persisted, so it
                // is re-derived. It must include the part index: a single
                // assistant message can carry several tool calls, and keying
                // them all `tool-<msgId>` made those ids collide — which
                // pruning (below) reads as one result, applying one decision
                // to all of them. Deterministic, so it is stable across loads.
                id: `tool-${msg.id}-${partIndex}`,
                tool: part.tool?.name || "",
                // A string here is truthy, so `|| {}` let malformed args from
                // an older session survive the round-trip back to the provider.
                args: isPlainObject(part.tool?.args) ? part.tool.args : {},
                execution: "sequential",
              };
              return {
                type: "tool",
                tool: toolCall,
                result: part.result,
              };
            }
          }),
        };
      });
    } catch (error) {
      console.error(
        "[AgentLoop] Failed to load history from sessionStore:",
        error,
      );
      this.history = [];
    }
  }

  // Build a copy of messages where oversized tool results are replaced with a
  // short marker, keeping the total the model sees under TOOL_RESULT_BUDGET.
  //
  // Only the view sent to the provider is pruned — this.history is untouched so
  // the session store keeps full content and compaction works normally.
  //
  // Every decision is recorded in this.pruneState and re-applied verbatim on
  // later turns, and any result already sent whole is frozen at full size. That
  // is the whole point: the bytes at a given position never change once sent, so
  // the provider's cached prefix stays valid and grows instead of being
  // invalidated two turns back on every turn (RC4). The previous sliding-window
  // version optimised the wrong thing — it saved ~250 tokens per old result and
  // paid a partial cache invalidation per turn for it.
  //
  // When frozen results alone exceed the budget, the overage is accepted.
  // Compaction (which now fires on a cost target, not window fit) is what
  // reclaims that, and it rebuilds history wholesale so the prefix is expected
  // to change there anyway.
  private pruneHistoryToolResults(messages: Message[]): Message[] {
    interface Candidate extends PruneCandidate {
      messageIndex: number;
      partIndex: number;
    }

    // The final assistant message holds results the model has not reasoned over
    // yet; replacing those before it reads them just forces a re-read. It is
    // still recorded as seen below, so it freezes rather than becoming eligible
    // again next turn — which would be the sliding window all over again.
    let lastAssistantIndex = -1;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "assistant") {
        lastAssistantIndex = i;
        break;
      }
    }

    const candidates: Candidate[] = [];
    const protectedIds = new Set<string>();
    messages.forEach((msg, messageIndex) => {
      if (msg.role !== "assistant") return;
      msg.parts.forEach((part, partIndex) => {
        if (part.type !== "tool" || !part.result) return;
        const candidate: Candidate = {
          id: part.tool.id,
          size: part.result.length,
          messageIndex,
          partIndex,
        };
        candidates.push(candidate);
        if (messageIndex === lastAssistantIndex) protectedIds.add(part.tool.id);
      });
    });
    if (candidates.length === 0) return messages;

    const { mustReapply, frozen, fresh } =
      this.pruneState.partition(candidates);

    const frozenSize =
      frozen.reduce((sum, c) => sum + c.size, 0) +
      mustReapply.reduce((sum, c) => sum + c.replacement.length, 0);
    const selectable = fresh.filter((c) => !protectedIds.has(c.id));
    const protectedSize = fresh
      .filter((c) => protectedIds.has(c.id))
      .reduce((sum, c) => sum + c.size, 0);
    const selected = PruneState.selectFreshToReplace(
      selectable,
      frozenSize + protectedSize,
      TOOL_RESULT_BUDGET_CHARS,
    );

    const replacements = new Map<string, string>();
    for (const c of mustReapply) replacements.set(c.id, c.replacement);
    for (const c of selected) {
      const replacement = renderPrunedToolResult(c.id, c.size);
      replacements.set(c.id, replacement);
      this.pruneState.recordReplaced(c.id, replacement);
      // Read dedup answers a repeat read with "it's already above". Once the
      // content above has been replaced with a marker that is false, and the
      // model would be left with nothing — so forget we ever showed it (RC5).
      const part = messages[c.messageIndex]?.parts[c.partIndex];
      if (part?.type === "tool" && part.tool.tool === "read") {
        const filePath = (part.tool.args as { filePath?: unknown })?.filePath;
        if (typeof filePath === "string") {
          markReadPruned(this.state.sessionId, filePath);
        }
      }
    }
    // Everything going out whole this turn is frozen from here on.
    for (const c of candidates) {
      if (!replacements.has(c.id)) this.pruneState.recordSeen(c.id);
    }

    if (replacements.size === 0) return messages;

    // Rebuild only the messages that actually change; the rest pass through by
    // reference so untouched objects stay identical.
    const changed = new Set(
      candidates
        .filter((c) => replacements.has(c.id))
        .map((c) => c.messageIndex),
    );
    return messages.map((msg, messageIndex) => {
      if (!changed.has(messageIndex)) return msg;
      return {
        ...msg,
        parts: msg.parts.map((part) => {
          if (part.type !== "tool") return part;
          const replacement = replacements.get(part.tool.id);
          return replacement === undefined
            ? part
            : { ...part, result: replacement };
        }),
      };
    });
  }

  // ===========================================================================
  // PUBLIC: run()
  // Main execution entry point - runs the continuous loop until completion
  // ===========================================================================
  async run(input: UserInput): Promise<LoopResult> {
    this.state = {
      ...this.state,
      status: "starting",
      projectPath: input.projectPath,
      agentMode: input.agentMode ?? "build",
      // Loop health is per-run. oscillationScore only ever climbs, so carrying
      // it across prompts would let one run's history stop the *next* one at
      // the health check before it ever reached the provider.
      loopHealth: {
        repeatedTools: 0,
        stagnantTurns: 0,
        oscillationScore: 0,
        repeatedReasoningScore: 0,
      },
    };
    // Fresh cancellation scope per run
    this.abort = new AbortController();

    // Reset per-run reminder state (this instance is reused across turns).
    this.recentToolCalls = [];
    this.recentEdits = [];
    this.pendingReminders = [];
    this.todoGateForces = 0;
    this.turnsSinceTodoWrite = 0;
    this.turnsSinceLastNudge = 0;
    this.filesMutatedThisRun = false;
    this.verifyAttempts = 0;
    this.mutatedFiles = new Set<string>();
    this.verifierAttempts = 0;
    this.lastVerifierReport = undefined;
    this.lastMemoryQueryText = "";
    this.lastMemoryBlock = undefined;
    this.memoryToolUsedThisRun = false;
    // History is reloaded below, and the ids are only meaningful against that
    // load — so decisions from a previous run cannot be carried over.
    this.pruneState.reset();

    // Watch for external file/git changes so the project-context cache doesn't
    // go stale between turns (grok #4). Idempotent per project.
    if (input.projectPath) ensureWatching(input.projectPath);

    try {
      this.state = { ...this.state, status: "running" };

      // Load permission rules for this project (project + user scopes)
      if (this.permissionSettings === undefined) {
        this.permissionSettings = new PermissionSettingsManager(
          input.projectPath,
        );
        this.permissionSettings.watch();
      }

      // Step 1: Collect project context (file tree, etc.)
      const contextResult = await this.collectContext(input.projectPath);
      if (!contextResult.success || !contextResult.value) {
        return this.fail("Context collection failed", contextResult.error);
      }

      // Initialize compiler once with the real project name (after context is
      // resolved). Previously this was done twice — the first instance with an
      // empty name was immediately discarded, wasting the allocation.
      this.compiler = new PromptCompiler(
        input.projectPath,
        contextResult.value.name,
        this.state.agentMode,
      );

      // Step 2: Run SessionStart hook
      await this.hooks.runSessionStart({
        sessionId: this.state.sessionId,
        turnCount: this.state.turnCount,
      });

      // Step 3: Emit session.created event
      BusEvents.sessionCreated(this.state.sessionId, input.projectPath);

      // Load session history from persistent storage
      await this.loadHistory();

      // Construct and push the new user message to history and store.
      // Attached images ride along as image parts, but only where the model can
      // actually see them — a text-only model rejects image content outright.
      const canSeeImages =
        !!input.images?.length &&
        (await modelSupportsImages(input.provider, input.model));
      const imageParts: MessagePart[] = canSeeImages
        ? input.images!.map((img) => ({
            type: "image",
            data: img.data,
            mediaType: img.mediaType,
            altText: img.altText,
          }))
        : [];
      if (input.images?.length && !canSeeImages) {
        // Loudly, not just to the log: the user attached something and would
        // otherwise watch the model claim it received no image.
        const note =
          `${input.model ?? input.provider} cannot accept image input, so ` +
          `${input.images.length} attached image(s) were not sent. ` +
          `Switch to a vision model (e.g. an Anthropic, OpenAI, or Gemini model) to use images.`;
        logger.warn(`[AgentLoop] ${note}`);
        BusEvents.stream(this.state.sessionId, {
          type: "notice",
          level: "warn",
          content: note,
        });
      }
      const initialUserMessage: Message = {
        id: randomUUID(),
        role: "user",
        // An image-only prompt carries no text. Providers reject empty text
        // blocks, so omit the part rather than send a blank one.
        parts: [
          ...(input.prompt
            ? [{ type: "text" as const, content: input.prompt }]
            : []),
          ...imageParts,
        ],
        timestamp: Date.now(),
      };
      this.history.push(initialUserMessage);
      await this.appendUserMessage(input.prompt, imageParts);
      this.memory.addMessage("user", input.prompt);

      let totalInputTokens = 0;
      let totalOutputTokens = 0;
      let totalCacheReadTokens = 0;
      // Reported separately for the hit rate only. These tokens are ALSO in
      // totalInputTokens (cache writes are billed input) — never add both into
      // a denominator or the writes count twice.
      let totalCacheWriteTokens = 0;
      // Occupancy of the model's window = last call's full input (each call
      // resends the whole conversation, so summing would double-count).
      let lastTurnContextTokens = 0;

      // Usage accumulated so far. Every exit below reports it — an abnormal
      // stop (loop health, max iterations, interrupt) has still spent whatever
      // tokens it spent, and dropping the totals renders the run as free.
      const usageSoFar = () => ({
        inputTokens: totalInputTokens,
        outputTokens: totalOutputTokens,
        cacheReadInputTokens: totalCacheReadTokens,
        cacheCreationInputTokens: totalCacheWriteTokens,
        contextTokens: lastTurnContextTokens,
      });

      // =======================================================================
      // CONTINUOUS LOOP - Core agent cycle
      // =======================================================================
      while (this.state.status === "running") {
        // Check: Have we hit max iterations?
        if (this.state.iterationCount >= this.config.maxIterations) {
          await this.stop("max_iterations_reached");
          return this.complete(
            "Max iterations reached",
            undefined,
            undefined,
            usageSoFar(),
          );
        }

        // Check: Loop health (detect stuck patterns)
        const healthAction = this.evaluateLoopHealth();
        if (healthAction.action === "stop") {
          await this.stop(healthAction.reason || "loop_health_stop");
          return this.complete(
            `Loop stopped: ${healthAction.reason}`,
            undefined,
            undefined,
            usageSoFar(),
          );
        }
        if (healthAction.action === "warn") {
          logger.debug(`[AgentLoop] Warning: ${healthAction.reason}`);
        }

        // Todo nudge: after several turns with no todowrite call, remind the
        // model to keep a plan. Queued as a transient reminder for this turn.
        if (
          shouldNudgeTodo(this.turnsSinceTodoWrite, this.turnsSinceLastNudge)
        ) {
          this.pendingReminders.push(todoNudgeReminder());
          this.turnsSinceLastNudge = 0;
        }

        // TurnStart Hook — per-turn setup, context injection
        await this.hooks.runTurnStart({
          sessionId: this.state.sessionId,
          turnCount: this.state.turnCount,
        });

        // Execute one turn: send prompt, get response, parse tools, execute
        const turnResult = await this.executeTurn(
          input.provider,
          input.model,
          contextResult.value,
        );

        // TurnEnd Hook — cost/usage tracking, logging
        await this.hooks.runTurnEnd(
          {
            sessionId: this.state.sessionId,
            turnCount: this.state.turnCount,
          },
          turnResult.usage,
        );
        if (!turnResult.success) {
          // Interrupted mid-turn (Ctrl+C / session.stop): the provider or tool
          // call was aborted — that is a clean stop, not a failure.
          if (this.abort.signal.aborted) {
            return this.complete(
              "Interrupted",
              undefined,
              undefined,
              usageSoFar(),
            );
          }
          return this.fail("Turn execution failed", turnResult.error);
        }

        // Advance reminder counters based on what this turn did.
        this.turnsSinceTodoWrite = turnResult.usedTodoWrite
          ? 0
          : this.turnsSinceTodoWrite + 1;
        this.turnsSinceLastNudge += 1;

        // Accumulate usage across turns
        if (turnResult.usage) {
          // Cache writes are billed input — fold them into ↓ so turn 1 isn't "free"
          totalInputTokens +=
            (turnResult.usage.inputTokens ?? 0) +
            (turnResult.usage.cacheCreationInputTokens ?? 0);
          totalOutputTokens += turnResult.usage.outputTokens ?? 0;
          totalCacheReadTokens += turnResult.usage.cacheReadInputTokens ?? 0;
          totalCacheWriteTokens +=
            turnResult.usage.cacheCreationInputTokens ?? 0;
          lastTurnContextTokens =
            (turnResult.usage.inputTokens ?? 0) +
            (turnResult.usage.cacheReadInputTokens ?? 0) +
            (turnResult.usage.cacheCreationInputTokens ?? 0);

          // Persist this turn's total tokens into the daily usage heatmap
          // (~/.freecode/usage.json), consumed by the TUI `/usage` command.
          recordDailyUsage({
            inputTokens: turnResult.usage.inputTokens ?? 0,
            outputTokens: turnResult.usage.outputTokens ?? 0,
            cacheReadTokens: turnResult.usage.cacheReadInputTokens ?? 0,
            cacheWriteTokens: turnResult.usage.cacheCreationInputTokens ?? 0,
          });

          BusEvents.stream(this.state.sessionId, {
            type: "usage_totals",
            totalInputTokens,
            totalOutputTokens,
            totalCacheReadTokens,
            totalCacheWriteTokens,
          });

          // Spend circuit breaker (RC7/D7): loop-health only warns on a stuck
          // pattern, nothing previously capped actual spend, so an oscillating
          // loop could burn a plan's quota silently. Off unless configured.
          const maxTurnTokens = getMaxTurnTokens();
          if (
            maxTurnTokens !== undefined &&
            totalInputTokens + totalOutputTokens > maxTurnTokens
          ) {
            await this.stop("spend_budget_exceeded");
            return this.complete(
              `Stopped: turn spend budget exceeded (${totalInputTokens + totalOutputTokens} tokens billed, limit ${maxTurnTokens}). Set FREECODE_MAX_TURN_TOKENS to change.`,
              undefined,
              undefined,
              usageSoFar(),
            );
          }
        }

        // No tool calls means the model wants to stop. Before completing, run
        // the todo-completion gate (grok-build style): if the plan still has
        // unfinished items, inject a reminder and force another turn — up to a
        // per-run cap so a stubborn list can't loop forever.
        if (turnResult.toolResults.length === 0) {
          const gate = evaluateTodoGate(this.state.sessionId);
          if (
            gate.forceContinue &&
            this.todoGateForces < TODO_GATE_MAX_FORCES
          ) {
            this.todoGateForces += 1;
            if (gate.reminder) this.pendingReminders.push(gate.reminder);
            console.log(
              `[AgentLoop] Todo gate ${this.todoGateForces}/${TODO_GATE_MAX_FORCES}: unfinished todos — forcing another turn.`,
            );
            this.state = {
              ...this.state,
              iterationCount: this.state.iterationCount + 1,
              turnCount: this.state.turnCount + 1,
            };
            continue;
          }

          // Verification gate: if this run changed files, run the project's
          // typecheck/build before finishing. On failure, feed the output back
          // and force another turn — capped so a red project still terminates.
          if (
            this.filesMutatedThisRun &&
            this.verifyAttempts < MAX_VERIFY_ATTEMPTS
          ) {
            const verifyCmd = resolveVerifyCommand(this.state.projectPath);
            if (verifyCmd) {
              this.verifyAttempts += 1;
              console.log(
                `[AgentLoop] Verification gate ${this.verifyAttempts}/${MAX_VERIFY_ATTEMPTS}: running \`${verifyCmd.command}\``,
              );
              const verify = await runVerify(
                verifyCmd.command,
                this.state.projectPath,
                this.abort.signal,
              );
              if (this.abort.signal.aborted)
                return this.complete(
                  "Interrupted",
                  undefined,
                  undefined,
                  usageSoFar(),
                );
              if (!verify.ok) {
                this.pendingReminders.push(
                  verifyFailureReminder(verifyCmd.label, verify.output),
                );
                this.state = {
                  ...this.state,
                  iterationCount: this.state.iterationCount + 1,
                  turnCount: this.state.turnCount + 1,
                };
                continue;
              }
            }
          }

          // Adversarial verification gate (claude-code style): for non-trivial
          // changes (>= VERIFIER_MIN_FILES files), spawn an independent
          // read-only verifier that assigns a PASS/FAIL/PARTIAL verdict the main
          // agent cannot self-assign. FAIL forces a fix; PASS/PARTIAL proceed
          // (PARTIAL is surfaced honestly by the model per the prompt contract).
          if (
            this.mutatedFiles.size >= VERIFIER_MIN_FILES &&
            this.verifierAttempts < MAX_VERIFIER_ATTEMPTS
          ) {
            this.verifierAttempts += 1;
            console.log(
              `[AgentLoop] Verifier ${this.verifierAttempts}/${MAX_VERIFIER_ATTEMPTS}: reviewing ${this.mutatedFiles.size} changed files.`,
            );
            const verification = await verifyChanges({
              projectPath: this.state.projectPath,
              provider: input.provider,
              model: input.model,
              originalRequest: input.prompt,
              changedFiles: [...this.mutatedFiles],
              priorReport: this.lastVerifierReport,
            });
            if (this.abort.signal.aborted)
              return this.complete(
                "Interrupted",
                undefined,
                undefined,
                usageSoFar(),
              );
            this.lastVerifierReport = verification.report;
            if (verification.verdict === "FAIL") {
              this.pendingReminders.push(
                verifierFailureReminder(verification.report),
              );
              this.state = {
                ...this.state,
                iterationCount: this.state.iterationCount + 1,
                turnCount: this.state.turnCount + 1,
              };
              continue;
            }
          }

          // The model answered with no further tool calls: this run is done and
          // the transcript is as complete as it will get. Mine it for durable
          // memories WITHOUT awaiting — the user's result returns now and
          // extraction finishes behind it (spec 2026-08-09-memory-write-path
          // D5). Same discipline as the graph's fire-and-forget onChange.
          this.kickMemoryExtraction(input.provider);

          return this.complete(
            "Done",
            turnResult.responseText,
            turnResult.thinking,
            usageSoFar(),
          );
        }

        this.state = {
          ...this.state,
          iterationCount: this.state.iterationCount + 1,
          turnCount: this.state.turnCount + 1,
        };
      }

      return this.complete("Loop stopped", undefined, undefined, usageSoFar());
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return this.fail("Loop error", message);
    }
  }

  // Resolve the model's real context window from models.dev, so the fit
  // constraint is judged against the actual limit (200K/1M) rather than a
  // conservative fallback. Returns undefined on lookup failure (offline /
  // unknown model), which makes shouldCompact fall back to the local table.
  //
  // This is only the *ceiling*. shouldCompact caps whatever it gets here at
  // DEFAULT_COMPACT_TARGET_TOKENS, so on a large-window model the cost target
  // is what actually fires compaction — not this number.
  private async resolveContextLimit(
    provider: string,
    model: string | undefined,
  ): Promise<number | undefined> {
    if (!model) return undefined;
    try {
      const limit = await getModelContextLimit(provider, model);
      if (limit <= 0) return undefined;
      // The reply reservation is charged against this same window, so subtract
      // it to get what the conversation may actually occupy. Must come from
      // resolveMaxOutputTokens — the identical call the request is built from
      // (see callProviderOnce) — or we would budget against one number and
      // send another.
      const usable = limit - (await resolveMaxOutputTokens(provider, model));
      return usable > 0 ? usable : limit;
    } catch {
      return undefined;
    }
  }

  // Recover from a context-overflow rejection by compacting and sending once
  // more. Rethrows anything else untouched, so ordinary failures still surface.
  //
  // The retry is deliberately not wrapped in this handler again: a second
  // overflow within the same turn means compaction did not free enough, and
  // looping on that burns quota without converging. claude-code records 1,279
  // sessions hitting 50+ consecutive compaction failures (up to 3,272) for
  // ~250K wasted calls a day before they added the same cap.
  private async compactAndRetry(
    error: unknown,
    system: SystemBlock[],
    provider: string,
    model: string | undefined,
    context: { tree: string; gitHead: string; clock: string },
  ): Promise<Awaited<ReturnType<typeof this.sendToProvider>>> {
    if (!isContextOverflowError(error)) throw error;

    if (this.overflowCompactions >= MAX_OVERFLOW_COMPACTIONS) {
      logger.error(
        `[AgentLoop] Context overflow persisted after ${this.overflowCompactions} compactions; giving up.`,
      );
      throw error;
    }
    this.overflowCompactions += 1;

    logger.warn(
      `[AgentLoop] Provider rejected the request as too long; compacting and retrying ` +
        `(attempt ${this.overflowCompactions}/${MAX_OVERFLOW_COMPACTIONS}).`,
    );
    BusEvents.stream(this.state.sessionId, {
      type: "notice",
      level: "warn",
      content:
        "The conversation outgrew the model's context window. Compacting and retrying.",
    });

    const outcome = await this.runCompaction(provider, model, "auto");
    // Nothing was freed (already minimal, or a PreCompact hook blocked it), so
    // the same request would be rebuilt at the same size.
    if (!outcome.compacted) throw error;

    // this.history was reloaded from the trimmed store inside runCompaction.
    return await this.sendToProvider(
      this.history,
      system,
      provider,
      model,
      context,
    );
  }

  // Build compaction options that summarize via the active provider/model.
  // Cancellable through the loop's AbortController. On provider-lookup failure
  // returns {}, so MemoryService.compact falls back to the heuristic summary.
  private compactOptions(
    provider: string,
    model: string | undefined,
  ): CompactOptions {
    try {
      const aiProvider = getProvider(provider as any);
      return {
        llmSummarize: createLlmSummarizer(aiProvider, model, this.abort.signal),
      };
    } catch {
      return {};
    }
  }

  // Compact if the running token count crossed the threshold. Emits UI events
  // and trims the session store so the reduction persists across turns.
  private async maybeCompact(
    provider: string,
    model: string | undefined,
  ): Promise<void> {
    const contextLimit = await this.resolveContextLimit(provider, model);
    if (
      !this.memory.shouldCompact(
        model ?? provider,
        contextLimit,
        this.lastMeasuredContextTokens,
      )
    )
      return;
    await this.runCompaction(provider, model, "auto");
  }

  // Runs one compaction: summary via MemoryService (stays in the system
  // prompt), history trimmed in the session store. PreCompact/PostCompact hooks
  // run inside MemoryService.compact(). Emits compaction_start/_complete for the
  // frontend UI. Shared by auto-compaction and the manual /compact path.
  async runCompaction(
    provider: string,
    model: string | undefined,
    trigger: "auto" | "manual",
  ): Promise<ApplyCompactionResult> {
    BusEvents.stream(this.state.sessionId, {
      type: "compaction_start",
      trigger,
    });
    const compactOptions = this.compactOptions(provider, model);

    let outcome: ApplyCompactionResult;
    if (this.sessionStore) {
      outcome = await applyCompaction({
        memory: this.memory,
        store: this.sessionStore,
        sessionId: this.state.sessionId,
        projectPath: this.state.projectPath,
        compactOptions,
      });
      // Reload so this.history matches the trimmed store.
      if (outcome.compacted) {
        await this.loadHistory();
        // The measurement describes the pre-trim request and would re-trigger
        // compaction on the next check. Clear it so the estimate is used until
        // the provider reports a fresh number.
        this.lastMeasuredContextTokens = 0;
      }
    } else {
      // No store (e.g. tests): memory-only compaction, slice native history.
      const result = await this.memory.compact(compactOptions);
      const compacted = result.success && !!result.summary;
      if (compacted) {
        this.history = this.history.slice(-result.preservedMessageIds.length);
      }
      outcome = {
        compacted,
        reason: result.success ? undefined : result.reason,
        tokensBefore: result.tokenCountBefore,
        tokensAfter: result.tokenCountAfter,
        messagesBefore: 0,
        messagesAfter: 0,
      };
    }

    if (outcome.compacted) {
      // Compaction rebuilds the provider-facing history, so the next request
      // MUST miss. Documented + generation bump so D2 reports it as expected
      // rather than as a harness bust.
      recordInvalidation(
        this.state.sessionId,
        "compaction",
        `${trigger} compaction: ${outcome.tokensBefore} → ${outcome.tokensAfter} tokens`,
      );
      bumpCacheGeneration(this.state.sessionId);
      this.recorder.recordCompactOccurred(
        outcome.tokensBefore,
        outcome.tokensAfter,
      );
    } else {
      logger.warn(
        `[AgentLoop] Compaction skipped: ${outcome.reason ?? "unknown reason"}`,
      );
    }

    BusEvents.stream(this.state.sessionId, {
      type: "compaction_complete",
      trigger,
      compacted: outcome.compacted,
      tokensBefore: outcome.tokensBefore,
      tokensAfter: outcome.tokensAfter,
      reason: outcome.reason,
    });
    return outcome;
  }

  // ===========================================================================
  // PRIVATE: executeTurn()
  // One iteration: build prompt → send to provider → normalize → parse → execute
  // Single LLM call per turn (Claude Code/OpenCode style)
  // ===========================================================================
  // Most recent user message text — the context we retrieve memories against.
  private getLastUserText(): string {
    for (let i = this.history.length - 1; i >= 0; i--) {
      const msg = this.history[i];
      if (msg.role !== "user") continue;
      return msg.parts
        .filter((p) => p.type === "text")
        .map((p) => (p as { content?: string }).content ?? "")
        .join("\n")
        .trim();
    }
    return "";
  }

  // Flatten the run's messages into a transcript for memory extraction. Text
  // parts only — tool args and results are the "how", and what we want is what
  // the user said and what was concluded.
  private buildTranscript(): { text: string; turns: number } {
    const lines: string[] = [];
    for (const msg of this.history) {
      if (msg.role !== "user" && msg.role !== "assistant") continue;
      const text = msg.parts
        .filter((p) => p.type === "text")
        .map((p) => (p as { content?: string }).content ?? "")
        .join("\n")
        .trim();
      if (text.length > 0) lines.push(`${msg.role}: ${text}`);
    }
    return { text: lines.join("\n\n"), turns: lines.length };
  }

  // Fire-and-forget memory extraction. Deliberately not awaited and deliberately
  // non-throwing: the run's result has already been decided, and a memory
  // failure must never surface as a task failure.
  private kickMemoryExtraction(provider: string): void {
    if (!this.memoryExtraction || this.abort.signal.aborted) return;

    const { text, turns } = this.buildTranscript();
    // Gates before the call, cheapest first: a skipped run costs a settings
    // read and two string comparisons instead of a provider round trip.
    const decision = shouldExtract({
      sessionId: this.state.sessionId,
      projectRoot: this.state.projectPath,
      transcript: text,
      turns,
      memoryToolUsed: this.memoryToolUsedThisRun,
      userText: this.getLastUserText(),
    });
    if (!decision.extract) {
      logger.debug(`[MemoryExtract] skipped: ${decision.reason}`);
      return;
    }

    void extractMemories({
      transcript: text,
      projectPath: this.state.projectPath,
      provider,
      sessionId: this.state.sessionId,
      // No model: extraction is a small classification job, so let the provider
      // pick its default rather than billing the session's (possibly large)
      // main model for it.
    }).catch(() => {
      // extractMemories already swallows; this guards the promise itself.
    });
  }

  private async executeTurn(
    provider: string,
    model: string | undefined,
    context: {
      name: string;
      projectPath: string;
      tree: string;
      gitHead: string;
      clock: string;
    },
  ): Promise<{
    success: boolean;
    toolResults: ToolResult[];
    responseText?: string;
    thinking?: string;
    error?: string;
    /** Whether this turn called todowrite — drives the todo-nudge counter. */
    usedTodoWrite?: boolean;
    usage?: {
      inputTokens: number;
      outputTokens: number;
      cacheReadInputTokens?: number;
      cacheCreationInputTokens?: number;
    };
  }> {
    try {
      // Build system prompt blocks using compiler
      const systemBlocks = await this.compiler.compileSystemBlocks(
        provider,
        model,
      );

      // The compaction summary — how the model knows what happened before a
      // compaction trimmed the history. Deliberately NOT
      // renderPromptMemoryContext(), which also renders `recentMessages`: those
      // grow every turn and are already present in the history verbatim, so
      // including them both duplicates content and rewrites the prefix on every
      // request. The summary alone changes only when compaction runs.
      const compactionSummary = this.memory.getPromptContext().summary;

      // Dynamic context (file tree + clock + memory) is inlined as the
      // first user message below, NOT as a system block — see the prepend in
      // callProviderOnce. Same shape as Claude Code's
      // SYSTEM_PROMPT_DYNAMIC_BOUNDARY (utils/api.ts:321).

      // Persistent-memory block: top-k memories relevant to the last user
      // message, surfaced by the graph service (spec D5). Per-session and
      // one-turn-behind: warm turns return the prior set instantly and refresh
      // in the background; a cold turn (session's first message, or right after
      // a topic change) waits a small budget for the fresh retrieval. Never
      // throws, never injects off-topic memories.
      //
      // Cache optimisation: within a single user request, the agent may loop
      // many times (tool call → result → tool call → …), but the user text
      // doesn't change between those inner turns. Re-querying the graph on
      // every inner turn wastes time and doesn't change the result. We cache the
      // last query text and skip the round-trip when nothing changed.
      const currentUserText = this.getLastUserText();
      if (currentUserText !== this.lastMemoryQueryText) {
        const memGraph = getMemoryGraphService(context.projectPath);
        this.lastMemoryBlock = renderRetrievedMemories(
          await memGraph.prepareMemories(this.state.sessionId, currentUserText),
        );
        this.lastMemoryQueryText = currentUserText;
      }
      const memoryBlock = this.lastMemoryBlock;
      // Persistent task list: re-rendered from the todo store every turn (not
      // from history), so the plan survives context compaction and the model
      // never loses track of remaining work on long tasks.
      const todoBlock = renderTodoPromptBlock(this.state.sessionId);
      // Drain any queued <system-reminder> blocks (todo nudge / completion
      // gate) into this turn's prompt. Transient — never persisted to history.
      const reminderText = this.pendingReminders.join("\n\n");
      this.pendingReminders = [];
      // Continual harness (Phase 1 — store + injection only, no refinement
      // yet: nothing writes an entry today outside tests). Off by default
      // (docs/superpowers/specs/2026-08-08-continual-harness-design.md §9);
      // loadHarnessPromptBlock checks settings before touching disk.
      const harnessBlock = loadHarnessPromptBlock(context.projectPath);
      // Session-only system blocks: todo state and transient reminders. They
      // change, but they sit at the tail of the system array and the message
      // anchors that actually drive cache reads are downstream — so even a
      // full rewrite here does not touch the cached static prefix.
      const sessionBlocks = [
        ...(compactionSummary
          ? [
              {
                text: `Compacted session summary:\n${compactionSummary}`,
                cache: false,
              },
            ]
          : []),
        ...(memoryBlock ? [{ text: memoryBlock, cache: false }] : []),
        ...(harnessBlock ? [{ text: harnessBlock, cache: false }] : []),
        ...(todoBlock ? [{ text: todoBlock, cache: false }] : []),
        ...(reminderText ? [{ text: reminderText, cache: false }] : []),
      ];
      const blocks = [...systemBlocks, ...sessionBlocks];

      // UserPromptSubmit Hook — can modify the joined system before send.
      // Must not collapse static + session into one cache:true blob (that
      // puts todos/memory/reminders under the breakpoint). See
      // apply-system-hook.ts.
      const joinedSystem = blocks.map((b) => b.text).join("\n\n");
      const hookResult = await this.hooks.runUserPromptSubmit(joinedSystem, {
        sessionId: this.state.sessionId,
        turnCount: this.state.turnCount,
      });
      const finalSystemBlocks = applySystemPromptHookRewrite(
        systemBlocks,
        sessionBlocks,
        hookResult.modifiedPrompt,
      );
      // A hook that rewrites the system prompt changes the first cache
      // breakpoint, so everything after it is re-written. Legitimate, but only
      // if it says so — otherwise D2 reports it as an unexplained bust.
      if (hookResult.modifiedPrompt) {
        recordInvalidation(
          this.state.sessionId,
          "system prompt hook",
          "a UserPromptSubmit hook rewrote the system prompt",
        );
      }

      // The threshold check is a prediction, and predictions miss: one turn can
      // add more than the buffer covers, or the session may have been resumed
      // onto a model with a smaller window. Rather than surface the rejection,
      // compact and send again — the only recovery that can work, since
      // retrying an oversized request unchanged always fails the same way.
      let providerResult: Awaited<ReturnType<typeof this.sendToProvider>>;
      try {
        providerResult = await this.sendToProvider(
          this.history,
          finalSystemBlocks,
          provider,
          model,
          context,
        );
        this.overflowCompactions = 0;
      } catch (error) {
        providerResult = await this.compactAndRetry(
          error,
          finalSystemBlocks,
          provider,
          model,
          context,
        );
      }

      // Record how full the window actually got. Each call resends the whole
      // conversation, so the last call's input *is* the occupancy — no summing.
      // Captured here (not in run()) because maybeCompact fires before this
      // turn's result reaches the caller.
      if (providerResult.usage) {
        this.lastMeasuredContextTokens =
          (providerResult.usage.inputTokens ?? 0) +
          (providerResult.usage.cacheReadInputTokens ?? 0) +
          (providerResult.usage.cacheCreationInputTokens ?? 0);
      }

      // Emit thinking content if present (for UI to display as streaming reasoning)
      if (providerResult.thinking) {
        this.lastThinking = providerResult.thinking;
        BusEvents.stream(this.state.sessionId, {
          type: "thinking",
          content: providerResult.thinking,
        });
      }

      // Emit text content if present (for UI to display)
      if (providerResult.content) {
        BusEvents.stream(this.state.sessionId, {
          type: "text",
          content: providerResult.content,
        });
      }

      // Record turn.started event
      this.recorder.recordTurnStarted(`turn-${this.state.turnCount}`);

      // Get tool calls from provider (native tool calling) or from text parsing
      let toolCalls: ToolCall[] =
        providerResult.toolCalls?.map((tc) => ({
          id: tc.id,
          tool: tc.name,
          args: tc.args as Record<string, unknown>,
          execution: "sequential" as const,
        })) ?? [];

      // If no native tool calls, try parsing [TOOL_CALLS] format from text
      if (toolCalls.length === 0) {
        toolCalls = this.parseResponse(
          this.normalizeResponse(providerResult.content),
        );
      }

      const usedTodoWrite = toolCalls.some((tc) => tc.tool === "todowrite");
      if (toolCalls.some((tc) => tc.tool === "memory")) {
        this.memoryToolUsedThisRun = true;
      }

      // Construct assistant message and push to history
      const assistantMessage: Message = {
        id: randomUUID(),
        role: "assistant",
        parts: [
          ...(providerResult.content
            ? [{ type: "text" as const, content: providerResult.content }]
            : []),
          ...toolCalls.map((tc) => ({
            type: "tool" as const,
            tool: tc,
          })),
        ],
        timestamp: Date.now(),
      };
      this.history.push(assistantMessage);

      // Usage belongs to the provider response, but the response is persisted
      // as several messages (text, then one per tool call). Attach it to the
      // first one written and clear it, so summing the field over a session
      // yields the real total instead of a multiple of it.
      let pendingUsage: MessageUsage | undefined = providerResult.usage;

      // No tools? Return early
      if (toolCalls.length === 0) {
        this.memory.addMessage("assistant", providerResult.content);
        await this.appendAssistantMessage(providerResult.content, pendingUsage);
        await this.maybeCompact(provider, model);
        return {
          success: true,
          toolResults: [],
          responseText: providerResult.content,
          thinking: providerResult.thinking,
          usage: providerResult.usage,
        };
      }

      // If there are tool calls, append assistant text (if present) to session store
      if (providerResult.content) {
        await this.appendAssistantMessage(providerResult.content, pendingUsage);
        pendingUsage = undefined;
      }

      // Execute tools with parallel-safe batching. Concurrency-safe tools
      // (isConcurrencySafe=true) run in a single Promise.all batch; anything
      // else runs solo. Post-work (loop-health, assistantMessage patch,
      // session-store append) is always in original order for determinism.
      const toolResults: ToolResult[] = new Array(toolCalls.length);
      // Images a tool produced this turn. A tool result is a text string on the
      // wire, so base64 can't ride inside it — the images are re-emitted as a
      // user message after the results instead (see below).
      const toolImages: MessagePart[] = [];
      const batches = planToolBatches(toolCalls);
      for (const { start, end, parallel } of batches) {
        const batch = toolCalls.slice(start, end);
        const batchResults = parallel
          ? await Promise.all(batch.map((tc) => this.executeTool(tc)))
          : [await this.executeTool(batch[0])];

        for (let k = 0; k < batch.length; k++) {
          const tc = batch[k];
          const result = batchResults[k];
          toolResults[start + k] = result;
          this.updateLoopHealth(tc, result);
          // Track file mutations so the verification gate only runs when this
          // run actually changed something.
          if (
            getTool(tc.tool)?.behavior?.isDestructive === true &&
            !result.error
          ) {
            this.filesMutatedThisRun = true;
            const a = tc.args as Record<string, unknown> | undefined;
            const fp = a && (a.filePath ?? a.path);
            if (typeof fp === "string") this.mutatedFiles.add(fp);
          }
          const part = assistantMessage.parts.find(
            (p) => p.type === "tool" && p.tool.id === tc.id,
          );
          if (part && part.type === "tool") {
            // modelOutput is the context-capped output; stdout is the full
            // (untruncated) copy kept only for UI. Re-sending stdout every turn
            // is what overflowed provider context windows.
            part.result = result.modelOutput || result.error || "";
          }
          // Carries the response's usage only when there was no assistant text
          // to hang it on (a tool-only response).
          await this.appendToolMessage(tc, result, pendingUsage);
          pendingUsage = undefined;

          const image = extractToolImage(result);
          if (image) {
            if (await modelSupportsImages(provider, model)) {
              toolImages.push({
                type: "image",
                data: image.data,
                mediaType: image.mediaType,
                altText: result.title,
              });
            } else {
              const note =
                `${model ?? provider} cannot accept image input, so the image ` +
                `read by ${tc.tool} was not sent. Switch to a vision model to use images.`;
              logger.warn(`[AgentLoop] ${note}`);
              BusEvents.stream(this.state.sessionId, {
                type: "notice",
                level: "warn",
                content: note,
              });
            }
          }
        }
      }

      // Hand the model any images the tools produced. They go in as a user
      // message after the tool results so the tool-call/tool-result pairing
      // stays intact — providers reject a tool result that isn't plain text.
      if (toolImages.length > 0) {
        const caption =
          toolImages.length === 1
            ? "Image from the tool call above:"
            : `${toolImages.length} images from the tool calls above:`;
        this.history.push({
          id: randomUUID(),
          role: "user",
          parts: [{ type: "text", content: caption }, ...toolImages],
          timestamp: Date.now(),
        });
        await this.appendUserMessage(caption, toolImages);
      }

      // Add assistant response to MemoryService for token tracking
      this.memory.addMessage(
        "assistant",
        providerResult.content || `[Executed ${toolCalls.length} tools]`,
      );

      await this.maybeCompact(provider, model);

      return {
        success: true,
        toolResults,
        responseText: providerResult.content,
        usedTodoWrite,
        usage: providerResult.usage,
      };
    } catch (error) {
      return { success: false, toolResults: [], error: String(error) };
    }
  }

  // ===========================================================================
  // PRIVATE: sendToProvider()
  // Send prompt to AI provider via provider adapter, wrapped in recovery:
  // transient errors (429/5xx/network timeout) retry with backoff, hard
  // failures fall through to the config-driven fallback provider chain.
  // ===========================================================================
  private async sendToProvider(
    messages: Message[],
    system: SystemBlock[],
    provider: string,
    model: string | undefined,
    // Context for the dynamic user-message prepend. Required so the
    // conversation's first user message stays accurate (file tree + clock).
    context: {
      tree: string;
      gitHead: string;
      clock: string;
    },
  ): Promise<{
    content: string;
    thinking?: string;
    toolCalls?: Array<{
      name: string;
      args: Record<string, unknown>;
      id: string;
    }>;
    usage?: {
      inputTokens: number;
      outputTokens: number;
      cacheReadInputTokens?: number;
      cacheCreationInputTokens?: number;
    };
    streamed?: boolean;
  }> {
    return this.recovery.callProvider(
      provider,
      // Fallback providers get their own default model — the configured model
      // id is specific to the primary provider.
      (p) =>
        this.callProviderOnce(
          p,
          messages,
          system,
          p === provider ? model : undefined,
          context,
        ),
      { sessionId: this.state.sessionId, signal: this.abort.signal },
    );
  }

  // One un-recovered provider attempt (streaming preferred, execute fallback).
  private async callProviderOnce(
    provider: string,
    messages: Message[],
    system: SystemBlock[],
    model: string | undefined,
    // Required so the dynamic user-message prepend has the file tree + clock.
    context: { tree: string; gitHead: string; clock: string },
  ): Promise<{
    content: string;
    thinking?: string;
    toolCalls?: Array<{
      name: string;
      args: Record<string, unknown>;
      id: string;
    }>;
    usage?: {
      inputTokens: number;
      outputTokens: number;
      cacheReadInputTokens?: number;
      cacheCreationInputTokens?: number;
    };
    streamed?: boolean;
  }> {
    const aiProvider = getProvider(provider as any);
    const tools = getToolDefs();

    // Cap tool results in old history turns to prevent token explosion on long
    // sessions. The model already processed those results fully when they were
    // new; re-sending 30K-char file reads from 10 turns ago is pure waste.
    // Last 2 turns are always preserved at full fidelity — the model may still
    // be acting on them. (jcode-style history pruning, spec D6)
    // Dynamic context (file tree + git head + clock) is inlined as the
    // conversation's FIRST user message, so the static system block above it
    // stays a stable cacheable prefix. Claude Code uses the same architecture
    // (utils/api.ts:321, SYSTEM_PROMPT_DYNAMIC_BOUNDARY).
    //
    // Position 0 is the most cache-sensitive slot in the whole request: every
    // byte after it depends on it. So it must contain ONLY things that are
    // stable across a session.
    //
    // In particular it must NOT carry the memory context. renderPromptMemoryContext
    // renders `recentMessages`, which grows every turn — putting that here
    // rewrote position 0 on every request and invalidated the entire
    // conversation prefix, which is exactly what the anchors are trying to
    // reuse. It is also redundant: those same messages are already in the
    // history immediately below. The memory *summary* still reaches the model
    // through the session system block built in executeTurn.
    const dynamicUserMessage: Message = {
      id: "dynamic-context",
      role: "user",
      parts: [
        {
          type: "text",
          content:
            "Project context:\n\n" +
            this.compiler.compileDynamicContext(
              context.tree,
              context.gitHead,
              "",
              undefined,
              context.clock,
            ),
        },
      ],
      // Fixed, not Date.now(): the id and timestamp are part of what the
      // pruner and any future serializer hash over, and a value that moves
      // every turn is the same prefix-invalidation bug in another guise.
      timestamp: 0,
    };
    const prunedMessages = this.pruneHistoryToolResults([
      dynamicUserMessage,
      ...messages,
    ]);
    // Prompt-cache awareness (jcode #9): warn before a send that will likely
    // miss a cold cache. Informational only — never blocks the send.
    const coldWarning = noteSendAndCheckCold(this.state.sessionId, provider);
    if (coldWarning) {
      BusEvents.stream(this.state.sessionId, {
        type: "cache_status",
        state: "cold",
        message: coldWarning,
      });
    }

    // Sized from the model's own ceiling rather than a per-provider constant,
    // and shared with resolveContextLimit so the reservation the request makes
    // is exactly the one compaction budgeted for.
    const maxTokens = await resolveMaxOutputTokens(provider, model);

    // Prefer streaming when the provider supports it AND we have a listener.
    // If either is missing, fall back to the one-shot execute() path so callers
    // and downstream code paths are unchanged.
    if (aiProvider.stream) {
      let content = "";
      let thinking = "";
      let toolCalls:
        | Array<{ name: string; args: Record<string, unknown>; id: string }>
        | undefined;
      let usage:
        | {
            inputTokens: number;
            outputTokens: number;
            cacheReadInputTokens?: number;
            cacheCreationInputTokens?: number;
          }
        | undefined;

      for await (const chunk of aiProvider.stream({
        messages: prunedMessages,
        system,
        tools,
        model,
        maxTokens,
        abortSignal: this.abort.signal,
        sessionId: this.state.sessionId,
      })) {
        if (this.abort.signal.aborted) break;
        switch (chunk.type) {
          case "text_delta":
            content += chunk.delta;
            BusEvents.stream(this.state.sessionId, {
              type: "text_delta",
              delta: chunk.delta,
            });
            break;
          case "thinking_delta":
            thinking += chunk.delta;
            BusEvents.stream(this.state.sessionId, {
              type: "thinking_delta",
              delta: chunk.delta,
            });
            break;
          case "tool_call":
            (toolCalls ??= []).push({
              id: chunk.id,
              name: chunk.name,
              args: chunk.args,
            });
            break;
          case "usage":
            usage = {
              inputTokens: chunk.usage.inputTokens,
              outputTokens: chunk.usage.outputTokens,
              cacheReadInputTokens: chunk.usage.cacheReadInputTokens,
              cacheCreationInputTokens: chunk.usage.cacheCreationInputTokens,
            };
            break;
          case "error":
            throw new Error(chunk.error);
          case "done":
            break;
        }
      }

      this.emitCacheWarm(usage);
      return {
        content,
        thinking: thinking ? thinking : undefined,
        toolCalls,
        usage,
        streamed: true,
      };
    }

    const result = await aiProvider.execute({
      messages: prunedMessages,
      system,
      tools,
      model,
      abortSignal: this.abort.signal,
      sessionId: this.state.sessionId,
    });
    this.emitCacheWarm(result.usage);
    return {
      content: result.content,
      thinking: result.thinking,
      toolCalls: result.toolCalls,
      usage: result.usage,
    };
  }

  // Surface post-turn cache hit/write token counts (jcode #9). Only emitted when
  // the provider actually reported cache activity, so non-caching turns stay quiet.
  private emitCacheWarm(usage?: {
    inputTokens?: number;
    cacheReadInputTokens?: number;
    cacheCreationInputTokens?: number;
  }): void {
    const { readTokens, writeTokens } = summarizeCache(usage);
    if (readTokens === 0 && writeTokens === 0) return;
    BusEvents.stream(this.state.sessionId, {
      type: "cache_status",
      state: "warm",
      cacheReadTokens: readTokens,
      cacheWriteTokens: writeTokens,
    });
    this.checkCacheHealth(usage, readTokens, writeTokens);
  }

  // Spec 2026-08-09 D2: a hit rate says money was lost; this says which turn
  // lost it. A miss the invalidation journal explains is normal and stays at
  // debug — an unexplained one means something mutated an already-sent message,
  // which is the bug RC3/RC4 were and which nothing currently catches.
  private checkCacheHealth(
    usage: { inputTokens?: number } | undefined,
    readTokens: number,
    writeTokens: number,
  ): void {
    if (!isCacheMissNoticesEnabled()) return;
    const problem = checkCacheUsage(this.state.sessionId, {
      cacheReadTokens: readTokens,
      cacheWriteTokens: writeTokens,
      inputTokens: usage?.inputTokens ?? 0,
    });
    if (!problem) return;

    if (problem.documentedCause) {
      logger.debug(
        `[cache] miss attributed to ${problem.documentedCause} ` +
          `(${problem.affectedTokens} tokens)`,
      );
      return;
    }
    logger.warn(`[cache] ${describeCacheProblem(problem)}`);
    BusEvents.stream(this.state.sessionId, {
      type: "cache_status",
      state: "miss",
      cacheReadTokens: readTokens,
      cacheWriteTokens: writeTokens,
      message: describeCacheProblem(problem),
    });
  }

  // ===========================================================================
  // PRIVATE: normalizeResponse()
  // Transform raw provider text to canonical AssistantContent[]
  // Handles [TOOL_CALLS]...[/TOOL_CALLS] format from mock provider
  // ===========================================================================
  private normalizeResponse(raw: string): {
    content: AssistantContent[];
    stopReason: string;
  } {
    const content: AssistantContent[] = [];
    const toolCallRegex = /\[TOOL_CALLS\]([\s\S]*?)\[\/TOOL_CALLS\]/g;
    let match;
    let lastIndex = 0;
    let hasTools = false;

    // Parse text content and tool calls from raw response
    while ((match = toolCallRegex.exec(raw)) !== null) {
      // Text before tool block
      if (match.index > lastIndex) {
        const text = raw.slice(lastIndex, match.index).trim();
        if (text) {
          content.push({ type: "text", text });
        }
      }

      // Parse tool block content
      const toolsStr = match[1];
      const toolLines = toolsStr.split("\n").filter((line) => line.trim());

      for (const line of toolLines) {
        const toolMatch = line.match(/^(\w+):(.+)$/);
        if (toolMatch) {
          const [, toolName, args] = toolMatch;
          content.push({
            type: "tool_use",
            id: `tool-${Date.now()}-${Math.random().toString(36).slice(2)}`,
            name: toolName,
            input: this.parseArgs(args.trim()),
          });
          hasTools = true;
        }
      }

      lastIndex = toolCallRegex.lastIndex;
    }

    // Text after last tool block
    if (lastIndex < raw.length) {
      const remaining = raw.slice(lastIndex).trim();
      if (remaining) {
        content.push({ type: "text", text: remaining });
      }
    }

    return {
      content,
      stopReason: hasTools ? "tool_use" : "completed",
    };
  }

  // ===========================================================================
  // PRIVATE: parseResponse()
  // Extract ToolCall[] from normalized response content
  // ===========================================================================
  private parseResponse(normalized: {
    content: AssistantContent[];
    stopReason: string;
  }): ToolCall[] {
    const toolCalls: ToolCall[] = [];

    for (const item of normalized.content) {
      if (item.type === "tool_use") {
        toolCalls.push({
          id: item.id,
          tool: item.name,
          args: item.input as unknown,
          execution: "sequential", // Default - parallel-safe tools batched separately
        });
      }
    }

    return toolCalls;
  }

  // ===========================================================================
  // PRIVATE: executeTool()
  // Execute a single tool via orchestrator, return ToolResult
  // Integrates PreToolUse and PostToolUse hooks for interception
  // Emits tool.called and tool.completed Bus events
  // Records function.call and function.output to rollout
  // ===========================================================================
  private async executeTool(toolCall: ToolCall): Promise<ToolResult> {
    const startTime = Date.now();

    // Build hook context
    const hookContext: HookContext = {
      sessionId: this.state.sessionId,
      turnCount: this.state.turnCount,
      toolName: toolCall.tool,
    };

    // PreToolUse Hook — can block or modify tool call
    const preResult = await this.hooks.runPreToolUse(toolCall, hookContext);
    if (!preResult.allowed) {
      logger.warn(
        `[AgentLoop] Tool blocked by hook: ${toolCall.tool} — ${preResult.blockReason ?? "no reason"}`,
      );
      const blockedResult = {
        id: `result-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        toolCallId: toolCall.id,
        tool: toolCall.tool,
        title: `Tool ${toolCall.tool}`,
        error: `Blocked by hook: ${preResult.blockReason ?? "no reason"}`,
      };
      // Record function.call blocked event
      this.recorder.recordHookBlocked(
        hookContext.toolName ?? toolCall.tool,
        preResult.blockReason ?? "no reason",
      );
      return blockedResult;
    }

    // Apply input modifications from hook if any
    if (preResult.modifiedInput) {
      toolCall = {
        ...toolCall,
        args: {
          ...(toolCall.args as Record<string, unknown>),
          ...preResult.modifiedInput,
        },
      };
    }

    // Permission pipeline (spec: 2026-07-18-permission-rules.md §5)
    // danger bypass → mode enforcement + rules → PermissionRequest hooks
    // (which may override ask→allow or anything→deny) → interactive ask.
    let permResult: PermissionRequestResult = {
      decision: "allow",
      modifiedInput: undefined,
    };
    if (this.state.agentMode !== "danger") {
      const args = toolCall.args as Record<string, unknown>;
      const evaluation = evaluatePermission({
        toolName: toolCall.tool,
        args,
        mode: this.state.agentMode,
        rules: this.permissionSettings?.getRuleSet() ?? {
          allow: [],
          ask: [],
          deny: [],
        },
        projectRoot: this.state.projectPath,
      });

      // Rule/mode deny is absolute — hooks cannot override deny→allow
      if (evaluation.decision === "deny") {
        return {
          id: `result-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          toolCallId: toolCall.id,
          tool: toolCall.tool,
          title: `Tool ${toolCall.tool}`,
          error:
            evaluation.source === "mode-enforced" && evaluation.matchedRule
              ? evaluation.matchedRule
              : `Permission denied${evaluation.matchedRule ? ` by rule: ${evaluation.matchedRule}` : ` (${evaluation.source})`}`,
        };
      }

      permResult = await this.hooks.runPermissionRequest(toolCall, hookContext);
      // No hook matched: the rules-engine decision stands
      const decision =
        permResult.decision === "passthrough"
          ? evaluation.decision
          : permResult.decision;

      if (decision === "deny") {
        logger.warn(
          `[AgentLoop] Tool requires permission: ${toolCall.tool} — ${permResult.reason ?? "approval needed"}`,
        );
        return {
          id: `result-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          toolCallId: toolCall.id,
          tool: toolCall.tool,
          title: `Tool ${toolCall.tool}`,
          error: `Permission denied: ${permResult.reason ?? "requires approval"}`,
        };
      }

      if (decision === "ask") {
        // Notification Hook — agent needs user attention for approval
        await this.hooks.runNotification(
          `Permission needed: ${toolCall.tool}${evaluation.matchedRule ? ` — ${evaluation.matchedRule}` : ""}`,
          hookContext,
        );
        const outcome = this.permissionSettings
          ? await promptForPermission({
              toolName: toolCall.tool,
              args,
              projectRoot: this.state.projectPath,
              settings: this.permissionSettings,
              sessionId: this.state.sessionId,
              reason:
                evaluation.matchedRule ??
                `${evaluation.source} (${this.state.agentMode} mode)`,
            })
          : { allowed: false, reason: "Permission system unavailable" };
        if (!outcome.allowed) {
          return {
            id: `result-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            toolCallId: toolCall.id,
            tool: toolCall.tool,
            title: `Tool ${toolCall.tool}`,
            error: `Permission denied: ${outcome.reason ?? "user declined"}`,
          };
        }
      }
    }

    // Apply input modifications from permission hook if any
    if (permResult.modifiedInput) {
      toolCall = {
        ...toolCall,
        args: {
          ...(toolCall.args as Record<string, unknown>),
          ...permResult.modifiedInput,
        },
      };
    }

    // Emit tool_start event for streaming
    BusEvents.stream(this.state.sessionId, {
      type: "tool_start",
      toolCallId: toolCall.id,
      toolName: toolCall.tool,
      args: toolCall.args as Record<string, unknown>,
    });

    // Record function.call event
    this.recorder.recordFunctionCall(
      toolCall.tool,
      toolCall.args as Record<string, unknown>,
      `turn-${this.state.turnCount}`,
    );

    console.log(`[AgentLoop] Executing tool: ${toolCall.tool}`);
    const context = {
      cwd: process.cwd(),
      sessionId: this.state.sessionId,
      abort: this.abort.signal,
    };

    let result: ToolResult;
    try {
      result = await this.orchestrator.execute(toolCall, context);
    } catch (error) {
      // PostToolUseFailure Hook — handle tool execution error
      const failureResult = await this.hooks.runPostToolUseFailure(
        toolCall,
        String(error),
        hookContext,
      );
      const errorResult: ToolResult = {
        id: `result-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        toolCallId: toolCall.id,
        tool: toolCall.tool,
        title: `Tool ${toolCall.tool}`,
        error: failureResult.additionalContext
          ? `${String(error)}\n\n${failureResult.additionalContext}`
          : String(error),
        duration_ms: Date.now() - startTime,
      };
      return errorResult;
    }

    // Emit tool_output with last 5 lines of stdout
    // Truncate each line to 200 chars to prevent terminal overflow
    const MAX_LINE_LEN = 200;
    const outputLines = (result.stdout || "")
      .split("\n")
      .filter((l) => l.trim())
      .slice(-5)
      .map((line) =>
        line.length > MAX_LINE_LEN ? line.slice(0, MAX_LINE_LEN) + "..." : line,
      );
    BusEvents.stream(this.state.sessionId, {
      type: "tool_output",
      toolCallId: toolCall.id,
      content: outputLines.join("\n"),
    });

    // PostToolUse Hook — can modify result
    const postResult = await this.hooks.runPostToolUse(
      toolCall,
      result,
      hookContext,
    );
    if (typeof postResult.modifiedOutput === "string") {
      result = {
        ...result,
        modelOutput: postResult.modifiedOutput,
        stdout: postResult.modifiedOutput,
      };
    }
    if (postResult.additionalContext) {
      const base = result.modelOutput ?? result.stdout ?? "";
      result = {
        ...result,
        modelOutput: `${base}\n\n${postResult.additionalContext}`,
      };
    }

    // Record function.output event
    this.recorder.recordFunctionOutput(
      toolCall.tool,
      result.stdout || result.error || "",
      Date.now() - startTime,
      `turn-${this.state.turnCount}`,
    );

    // Emit tool_complete event for streaming
    const duration_ms = Date.now() - startTime;
    const success = !result.error;
    BusEvents.stream(this.state.sessionId, {
      type: "tool_complete",
      toolCallId: toolCall.id,
      toolName: toolCall.tool,
      result: result.stdout || result.error || "",
      success,
      duration_ms,
    });

    return result;
  }

  // ===========================================================================
  // PRIVATE: collectContext()
  // Gather project context (name, path, file tree, git head) — frozen per
  // session so position 0 of the prompt stays byte-stable across user turns
  // (context/session-context.ts). tree-cache still refreshes for the process;
  // the prompt does not follow mid-session invalidations.
  // ===========================================================================
  private async collectContext(projectPath: string): Promise<{
    success: boolean;
    value?: {
      name: string;
      projectPath: string;
      tree: string;
      gitHead: string;
      clock: string;
    };
    error?: string;
  }> {
    try {
      const { ctx, clock } = getFrozenSessionContext(
        this.state.sessionId,
        projectPath,
      );
      return { success: true, value: { ...ctx, clock } };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  // ===========================================================================
  // PRIVATE: updateLoopHealth()
  // Track tool calls and state changes to detect stuck patterns
  // ===========================================================================
  private updateLoopHealth(toolCall: ToolCall, result: ToolResult): void {
    const argsHash = JSON.stringify(toolCall.args);
    const toolSignature = `${toolCall.tool}:${argsHash}`;

    // A. Track repeated identical tool calls
    this.recentToolCalls.push({ tool: toolCall.tool, args: argsHash });
    if (this.recentToolCalls.length > 10) {
      this.recentToolCalls.shift();
    }

    // Count how many times the same tool+args has been called recently
    const identicalCount = this.recentToolCalls.filter(
      (tc) => tc.tool === toolCall.tool && tc.args === argsHash,
    ).length;
    this.state.loopHealth = {
      ...this.state.loopHealth,
      repeatedTools: identicalCount - 1, // -1 because current call is in the array
    };

    // B. Track stagnant turns (no file changes). A mutating tool that returned
    // without an error counts as progress; scraping stdout wording is brittle.
    const madeFileChange =
      getTool(toolCall.tool)?.behavior?.isDestructive === true && !result.error;
    if (!madeFileChange) {
      this.state.loopHealth = {
        ...this.state.loopHealth,
        stagnantTurns: this.state.loopHealth.stagnantTurns + 1,
      };
    } else {
      this.state.loopHealth = {
        ...this.state.loopHealth,
        stagnantTurns: 0,
      };
    }

    // C. Track oscillation (edit/revert/edit on the same file). Only an edit
    // that undoes an earlier one scores — repeatedly editing one file is how
    // normal work on a large file looks, and counting that stops real tasks.
    // A failed edit changed nothing, so it can't be part of a revert cycle.
    if (
      toolCall.tool === "edit" &&
      !result.error &&
      toolCall.args &&
      typeof toolCall.args === "object"
    ) {
      const args = toolCall.args as Record<string, unknown>;
      const filePath = (args.filePath ?? args.path) as string;
      const { oldString, newString } = args;
      if (
        filePath &&
        typeof oldString === "string" &&
        typeof newString === "string"
      ) {
        const edit = toEditTransition(filePath, oldString, newString);
        const reverted = isRevert(this.recentEdits, edit);
        this.recentEdits.push(edit);
        if (this.recentEdits.length > RECENT_EDIT_WINDOW) {
          this.recentEdits.shift();
        }
        if (reverted) {
          this.state.loopHealth = {
            ...this.state.loopHealth,
            oscillationScore: this.state.loopHealth.oscillationScore + 1,
          };
        }
      }
    }
  }

  // ===========================================================================
  // PRIVATE: evaluateLoopHealth()
  // Multi-heuristic check for stuck patterns
  // Detects: repeated tools, stagnant turns, oscillation, max iterations
  // ===========================================================================
  private evaluateLoopHealth(): {
    action: "continue" | "warn" | "stop";
    reason?: string;
  } {
    const health = this.state.loopHealth;
    const heuristics = this.config.heuristics;

    // Two-tier braking: legitimate long tasks routinely re-read a file or edit
    // one file several times, so the first breach only warns; a hard stop is
    // reserved for 2× the threshold, where the pattern is almost certainly a
    // genuine loop. This keeps a runaway safety net without killing real work.

    // A. Repeated identical tool call - likely infinite loop
    if (health.repeatedTools >= heuristics.repeatedIdenticalThreshold * 2) {
      return { action: "stop", reason: "repeated_identical_tool" };
    }
    if (health.repeatedTools >= heuristics.repeatedIdenticalThreshold) {
      return { action: "warn", reason: "repeated_identical_tool" };
    }

    // B. No state change for N turns - likely stuck
    if (health.stagnantTurns >= heuristics.stagnantTurnsThreshold) {
      return { action: "warn", reason: "no_progress" };
    }

    // C. Oscillation detected - edit/revert/edit pattern
    if (health.oscillationScore >= heuristics.oscillationScoreThreshold * 2) {
      return { action: "stop", reason: "oscillation_detected" };
    }
    if (health.oscillationScore >= heuristics.oscillationScoreThreshold) {
      return { action: "warn", reason: "oscillation_detected" };
    }

    // D. Hard cap on iterations
    if (this.state.iterationCount >= heuristics.totalIterationLimit) {
      return { action: "stop", reason: "max_iterations_reached" };
    }

    return { action: "continue" };
  }

  // ===========================================================================
  // PRIVATE: parseArgs()
  // Parse tool argument string to object
  // ===========================================================================
  private parseArgs(argsStr: string): Record<string, unknown> {
    try {
      const parsed = JSON.parse(argsStr);
      return typeof parsed === "object" && parsed !== null
        ? parsed
        : { args: argsStr };
    } catch {
      return { args: argsStr };
    }
  }

  // ===========================================================================
  // PRIVATE: stop() / fail() / complete()
  // State transition helpers
  // ===========================================================================
  private async stop(reason: string): Promise<void> {
    this.state = { ...this.state, status: "stopped" };
    // Run Stop hook on termination
    await this.hooks.runStop(reason, {
      sessionId: this.state.sessionId,
      turnCount: this.state.turnCount,
    });
    // Emit session.updated event
    BusEvents.sessionUpdated(this.state.sessionId);
  }

  private fail(message: string, error?: string): LoopResult {
    // Emit session.error event
    BusEvents.sessionError(this.state.sessionId, error || message);
    return {
      success: false,
      message: error || message,
      turnCount: this.state.turnCount,
      iterationCount: this.state.iterationCount,
      finalState: { ...this.state, status: "error" },
    };
  }

  private complete(
    message: string,
    content?: string,
    thinking?: string,
    usage?: {
      inputTokens: number;
      outputTokens: number;
      cacheReadInputTokens?: number;
      contextTokens?: number;
    },
  ): LoopResult {
    // Emit session.updated event
    BusEvents.sessionUpdated(this.state.sessionId);
    return {
      success: true,
      message,
      content,
      thinking: thinking ?? this.lastThinking,
      turnCount: this.state.turnCount,
      iterationCount: this.state.iterationCount,
      finalState: this.state,
      usage,
    };
  }

  // ===========================================================================
  // PRIVATE: Session Store Helpers
  // Append messages to session store for persistence
  // ===========================================================================

  private async ensureProjectPath(): Promise<void> {
    if (!this.state.projectPath && this.sessionStore) {
      try {
        const all = await this.sessionStore.list();
        const meta = all.find((s) => s.id === this.state.sessionId);
        if (meta && meta.projectPath) {
          this.state.projectPath = meta.projectPath;
        }
      } catch {
        // ignore
      }
    }
  }

  private async appendUserMessage(
    content: string,
    imageParts: MessagePart[] = [],
  ): Promise<void> {
    if (!this.sessionStore) return;
    await this.ensureProjectPath();
    const message: SerializedMessage = {
      id: randomUUID(),
      role: "user",
      parts: [
        { type: "text", content },
        ...imageParts.flatMap((p) =>
          p.type === "image"
            ? [
                {
                  type: "image" as const,
                  data: p.data,
                  mediaType: p.mediaType,
                  altText: p.altText,
                },
              ]
            : [],
        ),
      ],
      timestamp: Date.now(),
    };
    await this.sessionStore.appendMessage(
      this.state.sessionId,
      message,
      this.state.projectPath,
    );
  }

  private async appendAssistantMessage(
    content: string,
    usage?: MessageUsage,
  ): Promise<string> {
    if (!this.sessionStore) return "";
    await this.ensureProjectPath();
    const id = randomUUID();
    const message: SerializedMessage = {
      id,
      role: "assistant",
      parts: [{ type: "text", content }],
      timestamp: Date.now(),
      ...(usage ? { usage } : {}),
    };
    await this.sessionStore.appendMessage(
      this.state.sessionId,
      message,
      this.state.projectPath,
    );
    // Set this message as the interrupt target so Ctrl+C marks it
    getInterruptHandler().setActive(this.state.sessionId, id);
    return id;
  }

  private async appendToolMessage(
    toolCall: ToolCall,
    result: ToolResult,
    usage?: MessageUsage,
  ): Promise<void> {
    if (!this.sessionStore) return;
    await this.ensureProjectPath();
    const message: SerializedMessage = {
      id: randomUUID(),
      role: "assistant",
      parts: [
        {
          type: "tool",
          tool: {
            name: toolCall.tool,
            args: toolCall.args as Record<string, unknown>,
          },
          // Persist the context-capped output (see appendToolMessage caller):
          // this is reloaded into history and re-sent to the provider.
          result: result.modelOutput || result.error || "",
        },
      ],
      timestamp: Date.now(),
      ...(usage ? { usage } : {}),
    };
    await this.sessionStore.appendMessage(
      this.state.sessionId,
      message,
      this.state.projectPath,
    );
  }

  // ===========================================================================
  // PUBLIC: getState() / interrupt() / runEffect()
  // Accessors for external monitoring/control
  // ===========================================================================
  getState(): SessionState {
    return this.state;
  }

  interrupt(): void {
    this.state = { ...this.state, status: "stopped" };
    // Cancel in-flight provider requests and tool executions immediately
    this.abort.abort();
  }

  // Effect wrapper around run(): fiber interruption is wired to interrupt(),
  // so cancelling the effect aborts the in-flight provider stream.
  runEffect(input: UserInput): Effect.Effect<LoopResult, Error> {
    return Effect.tryPromise({
      try: (signal) => {
        signal.addEventListener("abort", () => this.interrupt(), {
          once: true,
        });
        return this.run(input);
      },
      catch: (e) => (e instanceof Error ? e : new Error(String(e))),
    });
  }
}

// =============================================================================
// Factory Functions
// =============================================================================
export const createAgentLoop = (
  sessionId: string,
  config?: AgentLoopConfig,
): AgentLoop => {
  return new AgentLoop(sessionId, config);
};

// DI construction path (v3 spec): all collaborators are resolved from the
// Effect context, so a test layer swaps any of them without patching globals.
export const createAgentLoopEffect = (
  sessionId: string,
  config?: Pick<AgentLoopConfig, "maxIterations" | "heuristics">,
): Effect.Effect<
  AgentLoop,
  never,
  | HookRuntimeTag
  | ToolOrchestratorTag
  | SessionStoreTag
  | MemoryFactoryTag
  | RecorderFactoryTag
  | RecoveryManagerTag
> =>
  Effect.gen(function* () {
    const hooks = yield* HookRuntimeTag;
    const orchestrator = yield* ToolOrchestratorTag;
    const sessionStore = yield* SessionStoreTag;
    const memoryFactory = yield* MemoryFactoryTag;
    const recorderFactory = yield* RecorderFactoryTag;
    const recovery = yield* RecoveryManagerTag;

    return new AgentLoop(sessionId, {
      ...config,
      hooks,
      orchestrator,
      sessionStore,
      memory: memoryFactory.forSession(sessionId),
      recorder: recorderFactory.forSession(sessionId),
      recovery,
    });
  });
