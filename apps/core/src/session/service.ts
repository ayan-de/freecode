// =============================================================================
// Session Service - State machine + history management
// PRIMARY: Manages session lifecycle and conversation history
// INPUT: sessionId (string) on construction, Message on appendMessage()
// OUTPUT: SessionState (getState), Message[] (getHistory), string (fork)
// STATE: idle → starting → running → error/stopped
// PURPOSE: Tracks session status, message history, and supports session forking for sub-agents
// =============================================================================

import type { Message, SessionState } from "./types.js"
import { createInitialSessionState } from "./types.js"

// =============================================================================
// SessionService Interface
// =============================================================================
export interface SessionService {
  getHistory(): Message[]
  appendMessage(message: Message): void
  fork(point?: string): string
  getState(): SessionState
  updateState(update: Partial<SessionState>): void
}

// =============================================================================
// SessionServiceImpl - Concrete implementation
// =============================================================================
export class SessionServiceImpl implements SessionService {
  // ---------------------------------------------------------------------------
  // Private State
  // ---------------------------------------------------------------------------
  private state: SessionState
  private history: Message[] = []

  constructor(sessionId: string) {
    this.state = createInitialSessionState(sessionId)
  }

  // ===========================================================================
  // PUBLIC: getHistory()
  // Returns copy of message history
  // ===========================================================================
  getHistory(): Message[] {
    return [...this.history]
  }

  // ===========================================================================
  // PUBLIC: appendMessage()
  // Add message to history
  // ===========================================================================
  appendMessage(message: Message): void {
    this.history.push(message)
  }

  // ===========================================================================
  // PUBLIC: fork()
  // Create new session fork point, returns new session ID
  // TODO: Implement actual session forking for sub-agents
  // ===========================================================================
  fork(_point?: string): string {
    return `fork-${Date.now()}-${Math.random().toString(36).slice(2)}`
  }

  // ===========================================================================
  // PUBLIC: getState()
  // Returns current session state
  // ===========================================================================
  getState(): SessionState {
    return this.state
  }

  // ===========================================================================
  // PUBLIC: updateState()
  // Merge partial update into current state
  // ===========================================================================
  updateState(update: Partial<SessionState>): void {
    this.state = { ...this.state, ...update }
  }
}

// =============================================================================
// Factory Function
// =============================================================================
export const createSessionService = (sessionId: string): SessionService => {
  return new SessionServiceImpl(sessionId)
}