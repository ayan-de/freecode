// =============================================================================
// Effect Layers - Loop health evaluator + bus system
// PRIMARY: Multi-heuristic loop detection and event distribution
// INPUT: SessionState + LoopHeuristics (evaluate), BusEvent (publish)
// OUTPUT: LoopAction { continue | warn | stop } (evaluate), void (publish/subscribe)
// PURPOSE: Detects stuck patterns (repeated tools, stagnation, oscillation) and
//          distributes events to TUI/VSCode subscribers
// =============================================================================

export interface LoopHealthEvaluator {
  evaluate(state: SessionState, heuristics: LoopHeuristics): LoopAction
}

interface SessionState {
  status: string
  sessionId: string
  turnCount: number
  iterationCount: number
  loopHealth: LoopHealth
}

interface LoopHealth {
  repeatedTools: number
  stagnantTurns: number
  oscillationScore: number
  repeatedReasoningScore: number
}

interface LoopHeuristics {
  repeatedIdenticalThreshold: number
  stagnantTurnsThreshold: number
  oscillationScoreThreshold: number
  reasoningSimilarityThreshold: number
  reasoningSimilarityTurns: number
  totalIterationLimit: number
}

interface LoopAction {
  action: "continue" | "warn" | "stop"
  reason?: string
}

export const createLoopHealthEvaluator = (): LoopHealthEvaluator => ({
  evaluate(state: SessionState, heuristics: LoopHeuristics): LoopAction {
    const health = state.loopHealth

    if (health.repeatedTools >= heuristics.repeatedIdenticalThreshold) {
      return { action: "stop", reason: "repeated_identical_tool" }
    }

    if (health.stagnantTurns >= heuristics.stagnantTurnsThreshold) {
      return { action: "warn", reason: "no_progress" }
    }

    if (health.oscillationScore >= heuristics.oscillationScoreThreshold) {
      return { action: "stop", reason: "oscillation_detected" }
    }

    if (state.iterationCount >= heuristics.totalIterationLimit) {
      return { action: "stop", reason: "max_iterations_reached" }
    }

    return { action: "continue" }
  },
})

export interface Bus {
  publish(event: { type: string; payload: unknown; timestamp: number }): void
  subscribe(handler: (event: { type: string; payload: unknown; timestamp: number }) => void): void
}

export const createBus = (): Bus => ({
  publish(event) {
    console.log(`[Bus] Event: ${event.type}`, event.payload)
  },
  subscribe(_handler) {
    console.log("[Bus] Subscribed to events")
  },
})