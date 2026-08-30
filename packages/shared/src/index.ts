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
  CommandInfo,
  ProviderInfo,
  ProviderStatus,
  WebCredentialSpec,
  WebCredentials,
  ProviderDefinition,
  SessionConfig,
  EffortLevel,
  SessionInfo,
  SessionStatus,
  SessionMeta,
  SerializedMessage,
  SessionContext,
  SessionResumeResult,
  SessionFilter,
  ClaudeSessionMeta,
  ClaudeTranscript,
  ClaudeListFilter,
  ContextSegmentId,
  ContextSegmentStat,
  ContextBreakdown,
} from "./types.js";

// IPC Protocol
export type {
  JsonRpcRequest,
  JsonRpcResponse,
  StreamResponse,
  StreamEvent,
  QuestionSpec,
  PermissionPromptDecision,
  MethodName,
  MethodParams,
  MethodResult,
} from "./ipc/protocol.js";

export { METHODS } from "./ipc/protocol.js";
