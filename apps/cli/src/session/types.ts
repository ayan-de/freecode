// =============================================================================
// Session Types - Re-export of canonical types from agent/types.ts
// PURPOSE: Single source of truth — all session types are defined in agent/types.ts
// This file re-exports them for backwards compatibility and organization
// =============================================================================

export type {
  ExecutionMode,
  ModelTurn,
  AssistantContent,
  ToolCall,
  ToolResult,
  Artifact,
  ProviderID,
  RecoveryPolicy,
  LoopHealth,
  SessionState,
  Message,
  MessagePart,
  LoopHeuristics,
  LoopAction,
  UserInput,
  LoopResult,
  HookContext,
  HookResult,
  StopReason,
} from "../agent/types.js"

export {
  createInitialSessionState,
  DEFAULT_LOOP_HEURISTICS,
} from "../agent/types.js"