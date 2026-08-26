// =============================================================================
// Redirect policy — when a loop-health warning is allowed to cost a model call.
// PRIMARY: LoopAction + counters + history → RedirectDecision
// PURE: no IO, no clock, no provider. Every cap below is testable for free.
// Spec: docs/superpowers/specs/2026-08-26-trajectory-redirection.md, D2.
// =============================================================================

import type { LoopAction } from "../types.js";

/**
 * The three warn reasons worth re-planning on. Deliberately not `stop`: at that
 * point the run is over and the honest answer is to hand back to the user, not
 * to spend more money re-planning a corpse. `max_iterations_reached` is a
 * budget rather than a pathology — `wrapUpReminder()` already covers it.
 */
export type RedirectReason =
  | "repeated_identical_tool"
  | "oscillation_detected"
  | "no_progress";

const TRIGGERING = new Set<string>([
  "repeated_identical_tool",
  "oscillation_detected",
  "no_progress",
]);

export function isRedirectReason(reason?: string): reason is RedirectReason {
  return reason !== undefined && TRIGGERING.has(reason);
}

/** Why a warning did not become a redirection. Recorded, never thrown. */
export type RedirectSkipReason =
  | "disabled"
  | "cap_reached"
  | "reason_used"
  | "debounced"
  | "provider_error"
  | "timeout"
  | "unparseable"
  | "no_evidence";

/** Mirrors MAX_VERIFY_ATTEMPTS (`agent/verify.ts`). A third redirection means
 *  the advice is not what is wrong. */
export const REDIRECT_MAX_PER_RUN = 2;

/** The model needs turns to act on advice before being judged again. */
export const REDIRECT_DEBOUNCE_TURNS = 3;

export interface RedirectState {
  used: number;
  reasonsUsed: RedirectReason[];
  /** Turn index of the last redirection; null until one fires. */
  lastTurn: number | null;
  /**
   * Whether this run already logged that the feature is off. The `disabled`
   * skip is recorded once per run — it is how Phase 2 measures how often the
   * trigger *would* have fired — but a warn can recur every turn, and one line
   * per turn for a feature the user does not have is noise, not evidence.
   */
  disabledNoted: boolean;
}

export const createRedirectState = (): RedirectState => ({
  used: 0,
  reasonsUsed: [],
  lastTurn: null,
  disabledNoted: false,
});

export type RedirectDecision =
  | { redirect: true; reason: RedirectReason }
  | { redirect: false; skip: RedirectSkipReason }
  | { redirect: false; skip?: undefined };

export interface RedirectPolicyInput {
  action: LoopAction;
  /** `state.turnCount` at the top of the turn about to run. */
  turnCount: number;
  state: RedirectState;
  enabled: boolean;
  maxPerRun: number;
}

/**
 * Never throws, never mutates. A `{ redirect: false }` with no `skip` means
 * nothing happened worth recording — the common case, since most iterations
 * evaluate to `continue`.
 */
export function decideRedirect(input: RedirectPolicyInput): RedirectDecision {
  const { action, state, turnCount } = input;
  if (action.action !== "warn" || !isRedirectReason(action.reason)) {
    return { redirect: false };
  }
  const reason = action.reason;

  if (!input.enabled) {
    return state.disabledNoted
      ? { redirect: false }
      : { redirect: false, skip: "disabled" };
  }
  if (state.used >= input.maxPerRun) {
    return { redirect: false, skip: "cap_reached" };
  }
  if (state.reasonsUsed.includes(reason)) {
    // Re-advising on an unchanged reason produces the same advice.
    return { redirect: false, skip: "reason_used" };
  }
  if (
    state.lastTurn !== null &&
    turnCount - state.lastTurn < REDIRECT_DEBOUNCE_TURNS
  ) {
    return { redirect: false, skip: "debounced" };
  }
  return { redirect: true, reason };
}

/** Record a fired redirection. Returns a new state; does not mutate. */
export function noteRedirect(
  state: RedirectState,
  reason: RedirectReason,
  turnCount: number,
): RedirectState {
  return {
    ...state,
    used: state.used + 1,
    reasonsUsed: state.reasonsUsed.includes(reason)
      ? state.reasonsUsed
      : [...state.reasonsUsed, reason],
    lastTurn: turnCount,
  };
}

/** Record that the off-by-default skip has been logged for this run. */
export const noteDisabled = (state: RedirectState): RedirectState => ({
  ...state,
  disabledNoted: true,
});
