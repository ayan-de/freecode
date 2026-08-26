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
  id: string; // ULID for globally unique ordering
  seq: number; // Sequence number within aggregate
  aggregateID: string; // sessionId, subagentId, etc.
  timestamp: number;
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
  | ModelRequestEvent
  | ModelFirstTokenEvent
  | ModelResponseEvent
  | ModelErrorEvent
  | RedirectTriggeredEvent
  | RedirectSkippedEvent;

export interface TurnStartedEvent extends BaseEvent {
  type: "turn.started";
  turnId: string;
}

export interface TurnAbortedEvent extends BaseEvent {
  type: "turn.aborted";
  turnId: string;
  reason: string;
}

export interface FunctionCallEvent extends BaseEvent {
  type: "function.call";
  turnId: string;
  tool: string;
  args: Record<string, unknown>;
  seq: number;
}

export interface FunctionOutputEvent extends BaseEvent {
  type: "function.output";
  turnId: string;
  tool: string;
  /** `result.stdout` on success, `result.error` on failure — see `failed`. */
  output: string;
  /**
   * Whether the tool errored. Adds no new text to the log (`output` already
   * carried the error message), it just says which of the two `output` is —
   * so a reader does not have to scrape stdout wording to tell a failed call
   * from a successful one. Optional: logs written before this field existed
   * are still valid and simply report nothing.
   */
  failed?: boolean;
  duration_ms: number;
  seq: number;
}

export interface CompactOccurredEvent extends BaseEvent {
  type: "compact.occurred";
  beforeTokens: number;
  afterTokens: number;
}

export interface SubagentStartEvent extends BaseEvent {
  type: "subagent.start";
  subagentId: string;
  task: string;
}

export interface SubagentStopEvent extends BaseEvent {
  type: "subagent.stop";
  subagentId: string;
  result: string;
}

export interface SkillInvokedEvent extends BaseEvent {
  type: "skill.invoked";
  skillName: string;
  implicit: boolean;
}

export interface HookTriggeredEvent extends BaseEvent {
  type: "hook.triggered";
  hookName: string;
  hookEvent: string;
  blocked: boolean;
}

export interface HookBlockedEvent extends BaseEvent {
  type: "hook.blocked";
  hookName: string;
  reason: string;
}

export interface ContextOverflowEvent extends BaseEvent {
  type: "context.overflow";
  beforeTokens: number;
}

export interface ParseErrorEvent extends BaseEvent {
  type: "parse.error";
  turnId: string;
  parser: string;
  error: string;
}

// ============================================================================
// Model call events
//
// The provider round trip is the slowest and most failure-prone step in the
// loop, and until these existed it was the one step the log said nothing
// about. A stalled request left `turn.started` with no successor, which is
// indistinguishable in the log from a turn that simply ended — so "the agent
// is stuck" could not be told apart from "the agent is done" after the fact.
//
// `model.request` is written BEFORE the call, so an unterminated request is
// itself the evidence: request with no matching response/error is a hang.
// ============================================================================

export interface ModelRequestEvent extends BaseEvent {
  type: "model.request";
  turnId: string;
  provider: string;
  model: string;
  /** Messages sent, after history pruning. */
  messageCount: number;
  /** Tool definitions offered on this call. */
  toolCount: number;
  /** Approximate serialized prompt size; catches runaway context growth. */
  promptChars: number;
  streamed: boolean;
}

/** Time to first chunk — separates "provider never started" from "died mid-stream". */
export interface ModelFirstTokenEvent extends BaseEvent {
  type: "model.first_token";
  turnId: string;
  ttft_ms: number;
}

export interface ModelResponseEvent extends BaseEvent {
  type: "model.response";
  turnId: string;
  provider: string;
  model: string;
  duration_ms: number;
  ttft_ms?: number;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  /** Subset of `outputTokens` spent on hidden reasoning. */
  reasoningTokens?: number;
  /** Names only — the args are already captured by function.call. */
  toolCalls: string[];
  textChars: number;
  thinkingChars: number;
}

export interface ModelErrorEvent extends BaseEvent {
  type: "model.error";
  turnId: string;
  provider: string;
  model: string;
  duration_ms: number;
  /** `stall` = went silent past its budget; `abort` = cancelled by the user. */
  kind: "stall" | "abort" | "provider";
  error: string;
}

// ============================================================================
// Trajectory redirection events
// (spec 2026-08-26-trajectory-redirection.md, §6)
//
// **No direction text here, on purpose.** OTLP export consumes a `Trace`, which
// is a fold of these events, and the eval harness leans on the log carrying no
// message bodies. Model-authored advice can quote code, so it stays out. The
// text is already durable where it belongs: it is injected into the transcript,
// so the thread store and `freecode session export` have it.
//
// `evidenceEventIds` is what makes the advice auditable — `buildEvidence()` is
// pure, so given the log you can reconstruct the exact packet it was formed on.
// ============================================================================

export interface RedirectTriggeredEvent extends BaseEvent {
  type: "redirect.triggered";
  turnId: string;
  /** The loop-health reason that fired. */
  reason: string;
  evidenceEventIds: string[];
  directionCount: number;
  directionChars: number;
  latency_ms: number;
  inputTokens?: number;
  outputTokens?: number;
}

export interface RedirectSkippedEvent extends BaseEvent {
  type: "redirect.skipped";
  turnId: string;
  /** RedirectSkipReason — "cap_reached", "timeout", "disabled", … */
  reason: string;
}
