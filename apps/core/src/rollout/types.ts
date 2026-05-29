// =============================================================================
// Rollout Types - Event sourcing types for audit/replay
// PRIMARY: Typed events with aggregateID + seq for event sourcing
// EVENTS: TurnStarted, FunctionCall, FunctionOutput, etc.
// PURPOSE: Append-only JSONL log for debugging, replay, and analytics
// =============================================================================

// ============================================================================
// Base Event Structure
// ============================================================================

/**
 * Base event with aggregate + sequence for proper event sourcing.
 * Every rollout event has an id, seq, aggregateID, and timestamp.
 */
export interface BaseEvent {
  id: string          // ULID for globally unique ordering
  seq: number        // Sequence number within aggregate
  aggregateID: string // sessionId, subagentId, etc.
  timestamp: number
}

// ============================================================================
// Event Definitions
// ============================================================================

export type RolloutEvent =
  | TurnStartedEvent
  | TurnAbortedEvent
  | FunctionCallEvent
  | FunctionOutputEvent
  | CompactOccurredEvent
  | SubagentStartEvent
  | SubagentStopEvent
  | SkillInvokedEvent
  | HookTriggeredEvent
  | HookBlockedEvent
  | ContextOverflowEvent
  | ParseErrorEvent

export interface TurnStartedEvent extends BaseEvent {
  type: "turn.started"
  turnId: string
}

export interface TurnAbortedEvent extends BaseEvent {
  type: "turn.aborted"
  turnId: string
  reason: string
}

export interface FunctionCallEvent extends BaseEvent {
  type: "function.call"
  turnId: string
  tool: string
  args: Record<string, unknown>
  seq: number
}

export interface FunctionOutputEvent extends BaseEvent {
  type: "function.output"
  turnId: string
  tool: string
  output: string
  duration_ms: number
  seq: number
}

export interface CompactOccurredEvent extends BaseEvent {
  type: "compact.occurred"
  beforeTokens: number
  afterTokens: number
}

export interface SubagentStartEvent extends BaseEvent {
  type: "subagent.start"
  subagentId: string
  task: string
}

export interface SubagentStopEvent extends BaseEvent {
  type: "subagent.stop"
  subagentId: string
  result: string
}

export interface SkillInvokedEvent extends BaseEvent {
  type: "skill.invoked"
  skillName: string
  implicit: boolean
}

export interface HookTriggeredEvent extends BaseEvent {
  type: "hook.triggered"
  hookName: string
  hookEvent: string
  blocked: boolean
}

export interface HookBlockedEvent extends BaseEvent {
  type: "hook.blocked"
  hookName: string
  reason: string
}

export interface ContextOverflowEvent extends BaseEvent {
  type: "context.overflow"
  beforeTokens: number
}

export interface ParseErrorEvent extends BaseEvent {
  type: "parse.error"
  turnId: string
  parser: string
  error: string
}
