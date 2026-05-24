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
  | { type: "text"; content: string; toolName?: undefined; toolArgs?: undefined; toolResult?: undefined }
  | { type: "code"; content: string; toolName?: undefined; toolArgs?: undefined; toolResult?: undefined }
  | { type: "tool"; content: string; toolName: string; toolArgs: unknown; toolResult?: string }
  | { type: "done"; content: string; toolName?: undefined; toolArgs?: undefined; toolResult?: undefined }
  | { type: "error"; content: string; toolName?: undefined; toolArgs?: undefined; toolResult?: undefined };

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
} as const;

export type MethodName = keyof typeof METHODS;
export type MethodParams<M extends MethodName> = (typeof METHODS)[M]["params"];
export type MethodResult<M extends MethodName> = (typeof METHODS)[M]["result"];