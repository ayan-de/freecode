// =============================================================================
// Loop Health Evaluator
// PRIMARY: Multi-heuristic loop detection
// INPUT: SessionState + LoopHeuristics
// OUTPUT: LoopAction { continue | warn | stop }
// PURPOSE: Detects stuck patterns (repeated tools, stagnation, oscillation)
//          NOTE: moved here from effect/layers.ts when layers.ts became the
//          Layer wiring module (Phase 3 of the optimisation plan).
//          This is the ONLY copy of the policy — AgentLoop had a second,
//          identical private evaluateLoopHealth() until it was collapsed into
//          this one (spec 2026-08-26-trajectory-redirection.md, D10).
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

    // Two-tier braking: legitimate long tasks routinely re-read a file or edit
    // one file several times, so the first breach only warns; a hard stop is
    // reserved for 2× the threshold, where the pattern is almost certainly a
    // genuine loop. This keeps a runaway safety net without killing real work.

    // A. Repeated identical tool call - likely infinite loop
    if (health.repeatedTools >= heuristics.repeatedIdenticalThreshold * 2) {
      return { action: "stop", reason: "repeated_identical_tool" };
    }
    if (health.repeatedTools >= heuristics.repeatedIdenticalThreshold) {
      return { action: "warn", reason: "repeated_identical_tool" };
    }

    // B. No file change for N *turns* — the counter is advanced once per turn
    // by AgentLoop.advanceStagnation(), never per tool call.
    if (health.stagnantTurns >= heuristics.stagnantTurnsThreshold) {
      return { action: "warn", reason: "no_progress" };
    }

    // C. Oscillation detected - edit/revert/edit pattern. The score counts
    // reverts inside the recent-edit window, so it can fall as well as rise.
    if (health.oscillationScore >= heuristics.oscillationScoreThreshold * 2) {
      return { action: "stop", reason: "oscillation_detected" };
    }
    if (health.oscillationScore >= heuristics.oscillationScoreThreshold) {
      return { action: "warn", reason: "oscillation_detected" };
    }

    // D. Hard cap on iterations
    if (state.iterationCount >= heuristics.totalIterationLimit) {
      return { action: "stop", reason: "max_iterations_reached" };
    }

    return { action: "continue" };
  },
});
