// =============================================================================
// Bus - Event distribution system
// PRIMARY: Pub/sub event system for session events
// EVENTS: SessionDiff, SessionError, QuestionAsked, QuestionAnswered, etc.
// PURPOSE: Notifies TUI/VSCode frontends of session state changes
// =============================================================================

import { EventEmitter } from "events";

// ============================================================================
// Event Definitions
// ============================================================================

export interface BusEventDef<T extends string = string> {
  type: T;
}

// ============================================================================
// FileDiff for SessionDiff events
// ============================================================================

export interface FileDiff {
  path: string;
  action: "create" | "update" | "delete";
  content?: string;
  diff?: string;
}

// ============================================================================
// Full Bus Events (per architecture spec)
// ============================================================================

export interface SessionCreatedEvent {
  type: "session.created";
  sessionId: string;
  projectPath: string;
}

export interface SessionUpdatedEvent {
  type: "session.updated";
  sessionId: string;
}

export interface SessionErrorEvent {
  type: "session.error";
  sessionId: string;
  error: string;
  tool?: string;
}

export interface SessionDiffEvent {
  type: "session.diff";
  sessionId: string;
  diff: FileDiff[];
}

export interface ToolsChangedEvent {
  type: "tools.changed";
  added: Array<{ id: string; description: string }>;
  removed: string[];
}

export interface MCPToolsChangedEvent {
  type: "mcp.tools.changed";
  server: string;
}

export interface SubagentStartedEvent {
  type: "subagent.started";
  subagentId: string;
  subagentType: string;
  parentId: string;
  task: string;
}

export interface SubagentCompletedEvent {
  type: "subagent.completed";
  subagentId: string;
  subagentType: string;
  parentId: string;
  success: boolean;
  message?: string;
}

export interface ToolCalledEvent {
  type: "tool.called";
  sessionId: string;
  tool: string;
  toolCallId: string;
  args?: Record<string, unknown>;
}

export interface ToolCompletedEvent {
  type: "tool.completed";
  sessionId: string;
  tool: string;
  toolCallId: string;
  success: boolean;
  duration_ms?: number;
}

// ============================================================================
// Question Events (existing)
// ============================================================================

export interface QuestionAskedEvent {
  type: "question.asked";
  requestId: string;
  sessionId: string;
  questions: Array<{
    question: string;
    header?: string;
    options: Array<{ label: string; description: string }>;
    multiple?: boolean;
    custom?: boolean;
  }>;
}

export interface QuestionAnsweredEvent {
  type: "question.answered";
  requestId: string;
  answers: string[];
}

export interface QuestionRejectedEvent {
  type: "question.rejected";
  requestId: string;
}

// ============================================================================
// MCP Server Events
// ============================================================================

export interface MCPServerStartedEvent {
  type: "mcp.server.started";
  server: string;
  toolCount: number;
}

export interface MCPServerStoppedEvent {
  type: "mcp.server.stopped";
  server: string;
  reason?: string;
}

export interface MCPServerErrorEvent {
  type: "mcp.server.error";
  server: string;
  error: string;
}

// ============================================================================
// Union of all Bus Events
// ============================================================================

export type BusEvent =
  | SessionCreatedEvent
  | SessionUpdatedEvent
  | SessionErrorEvent
  | SessionDiffEvent
  | ToolsChangedEvent
  | MCPToolsChangedEvent
  | SubagentStartedEvent
  | SubagentCompletedEvent
  | ToolCalledEvent
  | ToolCompletedEvent
  | QuestionAskedEvent
  | QuestionAnsweredEvent
  | QuestionRejectedEvent
  | MCPServerStartedEvent
  | MCPServerStoppedEvent
  | MCPServerErrorEvent;

// ============================================================================
// Event Emitter Bus
// ============================================================================

type EventHandler = (event: BusEvent) => void;

class FreeCodeBus extends EventEmitter {
  private static instance: FreeCodeBus | null = null;

  static getInstance(): FreeCodeBus {
    if (!FreeCodeBus.instance) {
      FreeCodeBus.instance = new FreeCodeBus();
    }
    return FreeCodeBus.instance;
  }

  // Publish an event to all subscribers
  publish(event: BusEvent): void {
    this.emit(event.type, event);
    this.emit("*", event); // Wildcard for all-events subscriber
  }

  // Subscribe to a specific event type
  subscribe<T extends BusEvent["type"]>(
    eventType: T,
    handler: (event: Extract<BusEvent, { type: T }>) => void,
  ): () => void {
    this.on(eventType, handler as EventHandler);
    return () => this.off(eventType, handler as EventHandler);
  }

  // Subscribe to all events
  subscribeAll(handler: (event: BusEvent) => void): () => void {
    this.on("*", handler as EventHandler);
    return () => this.off("*", handler as EventHandler);
  }
}

// ============================================================================
// Global Bus Instance
// ============================================================================

export const bus = FreeCodeBus.getInstance();

// ============================================================================
// Question-specific Bus helpers
// ============================================================================

// Store for pending question requests awaiting answers
const pendingQuestions = new Map<
  string,
  {
    resolve: (answers: string[]) => void;
    reject: (error: Error) => void;
  }
>();

/**
 * Ask a question via the Bus. This publishes a QuestionAsked event
 * and waits for the answer via QuestionAnswered or QuestionRejected.
 */
export async function askQuestion(
  requestId: string,
  questions: QuestionAskedEvent["questions"],
): Promise<string[]> {
  return new Promise((resolve, reject) => {
    // Store the pending question
    pendingQuestions.set(requestId, { resolve, reject });

    // Publish the question event
    bus.publish({
      type: "question.asked",
      requestId,
      questions,
    } as QuestionAskedEvent);

    // Timeout after 5 minutes
    setTimeout(
      () => {
        if (pendingQuestions.has(requestId)) {
          pendingQuestions.delete(requestId);
          reject(new Error("Question timed out"));
        }
      },
      5 * 60 * 1000,
    );
  });
}

/**
 * Answer a pending question. Called by the frontend when user responds.
 */
export function answerQuestion(requestId: string, answers: string[]): void {
  const pending = pendingQuestions.get(requestId);
  if (pending) {
    pending.resolve(answers);
    pendingQuestions.delete(requestId);
  }
}

/**
 * Reject a pending question. Called by the frontend when user dismisses.
 */
export function rejectQuestion(requestId: string): void {
  const pending = pendingQuestions.get(requestId);
  if (pending) {
    pending.reject(new Error("Question rejected by user"));
    pendingQuestions.delete(requestId);
  }
}

// ============================================================================
// Convenience helpers for publishing common events
// ============================================================================

export const BusEvents = {
  sessionCreated: (sessionId: string, projectPath: string) =>
    bus.publish({
      type: "session.created",
      sessionId,
      projectPath,
    } as SessionCreatedEvent),

  sessionUpdated: (sessionId: string) =>
    bus.publish({ type: "session.updated", sessionId } as SessionUpdatedEvent),

  sessionError: (sessionId: string, error: string, tool?: string) =>
    bus.publish({
      type: "session.error",
      sessionId,
      error,
      tool,
    } as SessionErrorEvent),

  sessionDiff: (sessionId: string, diff: FileDiff[]) =>
    bus.publish({ type: "session.diff", sessionId, diff } as SessionDiffEvent),

  toolsChanged: (
    added: Array<{ id: string; description: string }>,
    removed: string[],
  ) =>
    bus.publish({ type: "tools.changed", added, removed } as ToolsChangedEvent),

  mcpToolsChanged: (server: string) =>
    bus.publish({ type: "mcp.tools.changed", server } as MCPToolsChangedEvent),

  subagentStarted: (
    subagentId: string,
    subagentType: string,
    parentId: string,
    task: string,
  ) =>
    bus.publish({
      type: "subagent.started",
      subagentId,
      subagentType,
      parentId,
      task,
    } as SubagentStartedEvent),

  subagentCompleted: (
    subagentId: string,
    subagentType: string,
    parentId: string,
    success: boolean,
    message?: string,
  ) =>
    bus.publish({
      type: "subagent.completed",
      subagentId,
      subagentType,
      parentId,
      success,
      message,
    } as SubagentCompletedEvent),

  toolCalled: (
    sessionId: string,
    tool: string,
    toolCallId: string,
    args?: Record<string, unknown>,
  ) =>
    bus.publish({
      type: "tool.called",
      sessionId,
      tool,
      toolCallId,
      args,
    } as ToolCalledEvent),

  toolCompleted: (
    sessionId: string,
    tool: string,
    toolCallId: string,
    success: boolean,
    duration_ms?: number,
  ) =>
    bus.publish({
      type: "tool.completed",
      sessionId,
      tool,
      toolCallId,
      success,
      duration_ms,
    } as ToolCompletedEvent),

  mcpServerStarted: (server: string, toolCount: number) =>
    bus.publish({
      type: "mcp.server.started",
      server,
      toolCount,
    } as MCPServerStartedEvent),

  mcpServerStopped: (server: string, reason?: string) =>
    bus.publish({
      type: "mcp.server.stopped",
      server,
      reason,
    } as MCPServerStoppedEvent),

  mcpServerError: (server: string, error: string) =>
    bus.publish({
      type: "mcp.server.error",
      server,
      error,
    } as MCPServerErrorEvent),
};

// Types already exported at top of file
