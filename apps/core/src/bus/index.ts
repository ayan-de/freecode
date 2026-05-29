// =============================================================================
// Bus - Event distribution system
// PRIMARY: Pub/sub event system for session events
// EVENTS: SessionDiff, SessionError, QuestionAsked, QuestionAnswered, etc.
// PURPOSE: Notifies TUI/VSCode frontends of session state changes
// =============================================================================

import { EventEmitter } from "events"

// ============================================================================
// Event Definitions
// ============================================================================

export interface BusEventDef<T extends string = string> {
  type: T
}

export interface QuestionAskedEvent {
  type: "question.asked"
  requestId: string
  sessionId: string
  questions: Array<{
    question: string
    header?: string
    options: Array<{ label: string; description: string }>
    multiple?: boolean
    custom?: boolean
  }>
}

export interface QuestionAnsweredEvent {
  type: "question.answered"
  requestId: string
  answers: string[]
}

export interface QuestionRejectedEvent {
  type: "question.rejected"
  requestId: string
}

export type BusEvent =
  | QuestionAskedEvent
  | QuestionAnsweredEvent
  | QuestionRejectedEvent

// ============================================================================
// Event Emitter Bus
// ============================================================================

type EventHandler = (event: BusEvent) => void

class FreeCodeBus extends EventEmitter {
  private static instance: FreeCodeBus | null = null

  static getInstance(): FreeCodeBus {
    if (!FreeCodeBus.instance) {
      FreeCodeBus.instance = new FreeCodeBus()
    }
    return FreeCodeBus.instance
  }

  // Publish an event to all subscribers
  publish(event: BusEvent): void {
    this.emit(event.type, event)
    this.emit("*", event) // Wildcard for all-events subscriber
  }

  // Subscribe to a specific event type
  subscribe<T extends BusEvent["type"]>(
    eventType: T,
    handler: (event: Extract<BusEvent, { type: T }>) => void
  ): () => void {
    this.on(eventType, handler as EventHandler)
    return () => this.off(eventType, handler as EventHandler)
  }

  // Subscribe to all events
  subscribeAll(handler: (event: BusEvent) => void): () => void {
    this.on("*", handler as EventHandler)
    return () => this.off("*", handler as EventHandler)
  }
}

// ============================================================================
// Global Bus Instance
// ============================================================================

export const bus = FreeCodeBus.getInstance()

// ============================================================================
// Question-specific Bus helpers
// ============================================================================

// Store for pending question requests awaiting answers
const pendingQuestions = new Map<
  string,
  {
    resolve: (answers: string[]) => void
    reject: (error: Error) => void
  }
>()

/**
 * Ask a question via the Bus. This publishes a QuestionAsked event
 * and waits for the answer via QuestionAnswered or QuestionRejected.
 */
export async function askQuestion(
  requestId: string,
  questions: QuestionAskedEvent["questions"]
): Promise<string[]> {
  return new Promise((resolve, reject) => {
    // Store the pending question
    pendingQuestions.set(requestId, { resolve, reject })

    // Publish the question event
    bus.publish({
      type: "question.asked",
      requestId,
      questions,
    } as QuestionAskedEvent)

    // Timeout after 5 minutes
    setTimeout(() => {
      if (pendingQuestions.has(requestId)) {
        pendingQuestions.delete(requestId)
        reject(new Error("Question timed out"))
      }
    }, 5 * 60 * 1000)
  })
}

/**
 * Answer a pending question. Called by the frontend when user responds.
 */
export function answerQuestion(requestId: string, answers: string[]): void {
  const pending = pendingQuestions.get(requestId)
  if (pending) {
    pending.resolve(answers)
    pendingQuestions.delete(requestId)
  }
}

/**
 * Reject a pending question. Called by the frontend when user dismisses.
 */
export function rejectQuestion(requestId: string): void {
  const pending = pendingQuestions.get(requestId)
  if (pending) {
    pending.reject(new Error("Question rejected by user"))
    pendingQuestions.delete(requestId)
  }
}

// Types already exported at top of file
