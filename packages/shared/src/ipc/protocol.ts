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
      type: "question_asked";
      requestId: string;
      sessionId?: string;
      questions: QuestionSpec[];
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
    params: { sessionId: "", message: "" },
    result: {} as StreamResponse,
  },
  "session.stop": {
    params: { sessionId: "" },
    result: undefined as void,
  },
  "providers.list": {
    params: undefined,
    result: [] as import("../types.js").ProviderInfo[],
  },
  "question.answer": {
    params: { requestId: "", answers: [] as string[] },
    result: undefined as void,
  },
  "question.reject": {
    params: { requestId: "" },
    result: undefined as void,
  },
} as const;

export type MethodName = keyof typeof METHODS;
export type MethodParams<M extends MethodName> = (typeof METHODS)[M]["params"];
export type MethodResult<M extends MethodName> = (typeof METHODS)[M]["result"];
