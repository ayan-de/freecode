// Shared types — re-exported explicitly to avoid empty export * issues with isolatedModules

// Types
export type {
  Message,
  MessagePart,
  ToolContext,
  ToolResult,
  ToolDef,
  ToolRegistry,
  JsonSchema,
  ToolListItem,
  FileChange,
  FileChangeAction,
  DiffResult,
  ParsedResponse,
  ProviderInfo,
  ProviderDefinition,
  SessionConfig,
  SessionInfo,
} from "./types.js";

// IPC Protocol
export type {
  JsonRpcRequest,
  JsonRpcResponse,
  StreamResponse,
  MethodName,
  MethodParams,
  MethodResult,
} from "./ipc/protocol.js";

export { METHODS } from "./ipc/protocol.js";