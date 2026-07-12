// =============================================================================
// Loop Health Evaluator
// PRIMARY: Multi-heuristic loop detection
// INPUT: SessionState + LoopHeuristics
// OUTPUT: LoopAction { continue | warn | stop }
// PURPOSE: Detects stuck patterns (repeated tools, stagnation, oscillation)
//          NOTE: moved here from effect/layers.ts when layers.ts became the
//          Layer wiring module (Phase 3 of the optimisation plan)
// =============================================================================

import type {
  SessionState,
  LoopHeuristics,
  LoopAction,
} from "../agent/types.js";

export interface LoopHealthEvaluator {
  evaluate(state: SessionState, heuristics: LoopHeuristics): LoopAction;
}

export const createLoopHealthEvaluator = (): LoopHealthEvaluator => ({
  evaluate(state: SessionState, heuristics: LoopHeuristics): LoopAction {
    const health = state.loopHealth;

    if (health.repeatedTools >= heuristics.repeatedIdenticalThreshold) {
      return { action: "stop", reason: "repeated_identical_tool" };
    }

    if (health.stagnantTurns >= heuristics.stagnantTurnsThreshold) {
      return { action: "warn", reason: "no_progress" };
    }

    if (health.oscillationScore >= heuristics.oscillationScoreThreshold) {
      return { action: "stop", reason: "oscillation_detected" };
    }

    if (state.iterationCount >= heuristics.totalIterationLimit) {
      return { action: "stop", reason: "max_iterations_reached" };
    }

    return { action: "continue" };
  },
});
