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

export type StreamEvent =
  | {
      type: "tool_start";
      toolCallId: string;
      toolName: string;
      args: Record<string, unknown>;
    }
  | { type: "tool_output"; toolCallId: string; content: string }
  | {
      type: "tool_complete";
      toolCallId: string;
      toolName: string;
      result: string;
      success: boolean;
      duration_ms?: number;
    }
  | { type: "thinking"; content: string } // full thinking, emitted at turn end (non-stream path)
  | { type: "text"; content: string } // full assistant text, emitted at turn end (non-stream path or as compatibility snapshot when streaming)
  | { type: "text_delta"; delta: string } // incremental assistant text chunk (streaming path)
  | { type: "thinking_delta"; delta: string } // incremental reasoning chunk (streaming path)
  | { type: "done"; content: string }
  | { type: "error"; content: string }
  | {
      // Prompt-cache awareness (jcode #9). "cold" is emitted before a send that
      // will likely miss Anthropic's ~5-min cache; "warm" carries post-turn
      // read/write token counts. Informational — frontends may render or ignore.
      type: "cache_status";
      state: "cold" | "warm";
      message?: string; // human-readable, set on "cold"
      cacheReadTokens?: number; // served from cache (cheap), set on "warm"
      cacheWriteTokens?: number; // written to cache this turn, set on "warm"
    }
  // Turn-level advisory the user needs to see (e.g. an attachment dropped
  // because the model can't accept it). Does not fail the turn.
  | { type: "notice"; level: "info" | "warn"; content: string }
  | { type: "compaction_start"; trigger: "auto" | "manual" } // compaction began
  | {
      type: "compaction_complete";
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
    result: {} as StreamResponse,
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
} as const;

export type MethodName = keyof typeof METHODS;
export type MethodParams<M extends MethodName> = (typeof METHODS)[M]["params"];
export type MethodResult<M extends MethodName> = (typeof METHODS)[M]["result"];
