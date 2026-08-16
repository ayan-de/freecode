// =============================================================================
// JSON-RPC Types
// =============================================================================

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number | string;
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number | string;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

// =============================================================================
// Streaming Response
// =============================================================================

export type StreamResponse =
  | {
      type: "text";
      content: string;
      toolName?: undefined;
      toolArgs?: undefined;
      toolResult?: undefined;
    }
  | {
      type: "code";
      content: string;
      toolName?: undefined;
      toolArgs?: undefined;
      toolResult?: undefined;
    }
  | {
      type: "tool";
      content: string;
      toolName: string;
      toolArgs: unknown;
      toolResult?: string;
    }
  | {
      type: "done";
      content: string;
      toolName?: undefined;
      toolArgs?: undefined;
      toolResult?: undefined;
    }
  | {
      type: "error";
      content: string;
      toolName?: undefined;
      toolArgs?: undefined;
      toolResult?: undefined;
    };

export interface QuestionSpec {
  question: string;
  header?: string;
  options: Array<{ label: string; description: string }>;
  multiple?: boolean;
  custom?: boolean;
}

/** User's answer to a permission prompt */
export type PermissionPromptDecision =
  | "allow-once"
  | "allow-session"
  | "allow-project"
  | "allow-always"
  | "deny";

// `sessionId` is populated on every variant when the event is relayed through
// the bus (see `busEventToClientEvent` in apps/core/src/bus/bridge.ts, which
// stamps it from the `StreamRelayEvent` wrapper) — it's optional here because
// event *authors* below construct these payloads without it. Consumers that
// multiplex several sessions over one process's stdout (e.g. frontends
// driving multiple concurrent sessions) need it to route each line; the TUI
// and per-session SSE channel don't, since they're already scoped to one
// session and can ignore the field.
export type StreamEvent =
  | {
      type: "tool_start";
      sessionId?: string;
      toolCallId: string;
      toolName: string;
      args: Record<string, unknown>;
    }
  | { type: "tool_output"; sessionId?: string; toolCallId: string; content: string }
  | {
      type: "tool_complete";
      sessionId?: string;
      toolCallId: string;
      toolName: string;
      result: string;
      success: boolean;
      duration_ms?: number;
    }
  | { type: "thinking"; sessionId?: string; content: string } // full thinking, emitted at turn end (non-stream path)
  | { type: "text"; sessionId?: string; content: string } // full assistant text, emitted at turn end (non-stream path or as compatibility snapshot when streaming)
  | { type: "text_delta"; sessionId?: string; delta: string } // incremental assistant text chunk (streaming path)
  | { type: "thinking_delta"; sessionId?: string; delta: string } // incremental reasoning chunk (streaming path)
  | { type: "done"; sessionId?: string; content: string }
  | { type: "error"; sessionId?: string; content: string }
  // Follow-up queue (spec 2026-08-05-queued-messages-design): a session.send
  // arrived while a turn was already in progress and was parked instead of
  // racing. `id` matches the `QueuedMessage`; `content` is the original prompt
  // so the UI can echo it back. `message_dequeued` fires when the same id is
  // pulled out via session.dequeue (or, implicitly, when the queue finally
  // starts its turn — the UI treats that as a state change to "in-flight").
  | { type: "message_queued"; sessionId?: string; id: string; content: string }
  | { type: "message_dequeued"; sessionId?: string; id: string }
  // A memory was written about the user WITHOUT them asking (turn-end
  // extraction, spec 2026-08-09-memory-write-path D5). Arrives after the
  // turn's `done` because extraction is fire-and-forget, so frontends must
  // treat it as an out-of-band notice rather than part of the turn. Never
  // emitted for the `memory` tool — that already shows as a tool call.
  | {
      type: "memory_saved";
      sessionId?: string;
      memories: Array<{ type: string; name: string }>;
    }
  // Automatic (non-tool-call) retrieval surfaced one or more saved memories
  // into this turn's prompt (spec D5, graph/index.ts prepareMemories).
  // Emitted once per distinct user message that gets a hit — not every
  // inner-loop tool-call turn — so the UI shows a single notice per request
  // rather than repeating it. Silent when nothing relevant was found.
  | {
      type: "memory_injected";
      sessionId?: string;
      memories: Array<{ type: string; name: string }>;
    }
  | {
      // Prompt-cache awareness (jcode #9). "cold" is emitted before a send that
      // will likely miss Anthropic's ~5-min cache; "warm" carries post-turn
      // read/write token counts. Informational — frontends may render or ignore.
      type: "cache_status";
      sessionId?: string;
      // "miss" is the harness-bug alarm (spec 2026-08-09 D2): the prefix was
      // busted with no recorded cause, i.e. something changed a message that
      // had already been sent. A legitimate rebuild (compaction) is documented
      // in the invalidation journal and never reaches the frontend.
      state: "cold" | "warm" | "miss";
      message?: string; // human-readable, set on "cold" and "miss"
      cacheReadTokens?: number; // served from cache (cheap), set on "warm"/"miss"
      cacheWriteTokens?: number; // written to cache this turn, set on "warm"/"miss"
    }
  // Turn-level advisory the user needs to see (e.g. an attachment dropped
  // because the model can't accept it). Does not fail the turn.
  | { type: "notice"; sessionId?: string; level: "info" | "warn"; content: string }
  // Running spend for the current run() — emitted once per completed turn so
  // the frontend can render a live per-session counter (spec
  // 2026-08-05-token-efficiency, D7). Core computes; frontends only display.
  | {
      type: "usage_totals";
      sessionId?: string;
      // Already includes cache writes — they are billed as input. The separate
      // totalCacheWriteTokens below is the same tokens broken out for the cache
      // hit rate, so summing the two double-counts them.
      totalInputTokens: number;
      totalOutputTokens: number;
      totalCacheReadTokens: number;
      totalCacheWriteTokens?: number;
    }
  | { type: "compaction_start"; sessionId?: string; trigger: "auto" | "manual" } // compaction began
  | {
      type: "compaction_complete";
      sessionId?: string;
      trigger: "auto" | "manual";
      compacted: boolean; // false when there was nothing to compact / it was blocked
      tokensBefore: number;
      tokensAfter: number;
      reason?: string; // why it didn't compact, when compacted=false
    }
  | {
      type: "question_asked";
      requestId: string;
      sessionId?: string;
      questions: QuestionSpec[];
    }
  | {
      type: "permission_asked";
      requestId: string;
      sessionId?: string;
      toolName: string;
      args: Record<string, unknown>;
      /** Human-readable summary, e.g. the bash command or file path */
      description: string;
      /** Rule offered for "always allow", e.g. "Bash(npm run test:*)" */
      suggestedRule?: string;
      /** Which rule or mode default triggered the ask */
      reason?: string;
    };

// =============================================================================
// IPC Method Signatures
// =============================================================================

export const METHODS = {
  "tools.list": {
    params: undefined,
    result: [] as import("../types.js").ToolListItem[],
  },
  "tools.call": {
    params: { name: "", args: {} as Record<string, unknown> },
    result: {} as import("../types.js").ToolResult,
  },
  "session.start": {
    params: { projectPath: "", provider: "" },
    result: { sessionId: "" },
  },
  "session.send": {
    // METHODS entries are values, not types — the exported MethodParams<M>
    // reads their inferred shape, so an optional field needs a cast.
    params: {} as {
      sessionId: string;
      message: string;
      images?: Array<{ data: string; mediaType: string; altText?: string }>;
    },
    // The LoopResult shape when the turn ran normally. When the session was
    // already busy, the call parks the prompt in the follow-up queue and
    // resolves immediately with { queued: true, id } — the UI uses the
    // `message_queued` stream event for the same data so web/SSE subscribes
    // stay in sync.
    result: {} as
      | StreamResponse
      | { queued: true; id: string },
  },
  "session.dequeue": {
    // Removes a previously-queued message by id (no-op if it already started
    // sending). The result tells the caller whether something was actually
    // removed, so the UI can decide between "drop the indicator" and "ignore
    // — the message is already in flight".
    params: { sessionId: "" as string, id: "" as string },
    result: { removed: false as boolean },
  },
  "session.stop": {
    params: { sessionId: "" },
    result: undefined as void,
  },
  "session.compact": {
    params: { sessionId: "" },
    result: {} as {
      compacted: boolean;
      tokensBefore: number;
      tokensAfter: number;
      reason?: string;
    },
  },
  "session.list": {
    // METHODS entries are values, not types — an optional field needs a cast.
    params: {} as {
      projectPath?: string;
      status?: import("../types.js").SessionStatus;
    },
    result: [] as import("../types.js").SessionMeta[],
  },
  "session.resume": {
    params: { sessionId: "" },
    result: {} as import("../types.js").SessionResumeResult,
  },
  // Lists Claude Code sessions discovered under $CLAUDE_CONFIG_DIR (defaults
  // to ~/.claude). Read-only: core never writes to the user's Claude Code
  // store. See apps/core/src/claude-sessions/.
  "session.claudeList": {
    params: {} as {
      projectPath?: string;
      limit?: number;
    },
    result: [] as import("../types.js").ClaudeSessionMeta[],
  },
  // Reads a Claude Code session transcript and converts it to the
  // SerializedMessage shape so the frontend can reuse the existing
  // preview-markdown renderer.
  "session.claudeTranscript": {
    params: { sessionId: "" },
    result: {} as import("../types.js").ClaudeTranscript,
  },
  "providers.list": {
    params: undefined,
    result: [] as import("../types.js").ProviderInfo[],
  },
  "commands.list": {
    params: { projectPath: "" },
    result: [] as import("../types.js").CommandInfo[],
  },
  "commands.resolve": {
    params: { name: "", args: [] as string[], projectPath: "" },
    result: { prompt: "" },
  },
  "question.answer": {
    params: { requestId: "", answers: [] as string[] },
    result: undefined as void,
  },
  "question.reject": {
    params: { requestId: "" },
    result: undefined as void,
  },
  "permission.answer": {
    params: {
      requestId: "",
      decision: "deny" as PermissionPromptDecision,
      editedRule: undefined as string | undefined,
    },
    result: undefined as void,
  },
  "permission.reject": {
    params: { requestId: "" },
    result: undefined as void,
  },
  "usage.get": {
    params: undefined,
    result: [] as { date: string; tokencount: number }[],
  },
  "skills.list": {
    params: { projectPath: undefined as string | undefined },
    result: [] as {
      name: string;
      description?: string;
      scope: string;
    }[],
  },
  "mcp.status": {
    params: { name: undefined as string | undefined },
    result: [] as {
      name: string;
      type: string;
      enabled: boolean;
      status: "connected" | "disconnected";
      toolCount: number;
      tools: string[];
    }[],
  },
  // Persisted prompt history — up-arrow recall across sessions. Core owns
  // ~/.freecode/history.jsonl; the TUI seeds its in-memory ring at startup
  // and appends on every submit.
  "history.list": {
    params: undefined,
    result: [] as string[],
  },
  "history.append": {
    params: { text: "" },
    result: undefined as void,
  },
  // Open the optional graph explorer in the browser. Returns { url } on
  // success; { error: "not-installed" } if the user hasn't run
  // `freecode memory ui-install` yet (the addon is opt-in, ~280 KB download
  // from the GitHub release). Spec: 2026-08-04-memory-graph-explorer-design.md.
  "graph.explore": {
    params: undefined,
    result: {} as { url: string } | { error: "not-installed" },
  },
} as const;

export type MethodName = keyof typeof METHODS;
export type MethodParams<M extends MethodName> = (typeof METHODS)[M]["params"];
export type MethodResult<M extends MethodName> = (typeof METHODS)[M]["result"];
