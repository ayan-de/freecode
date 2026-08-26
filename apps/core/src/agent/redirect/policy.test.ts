import test from "node:test";
import assert from "node:assert/strict";
import {
  createRedirectState,
  decideRedirect,
  noteDisabled,
  noteRedirect,
  REDIRECT_DEBOUNCE_TURNS,
  REDIRECT_MAX_PER_RUN,
  type RedirectReason,
  type RedirectState,
} from "./policy.js";
import type { LoopAction } from "../types.js";

const warn = (reason: string): LoopAction => ({ action: "warn", reason });

function decide(
  action: LoopAction,
  state: RedirectState,
  turnCount = 100,
  enabled = true,
) {
  return decideRedirect({
    action,
    turnCount,
    state,
    enabled,
    maxPerRun: REDIRECT_MAX_PER_RUN,
  });
}

const REASONS: RedirectReason[] = [
  "repeated_identical_tool",
  "oscillation_detected",
  "no_progress",
];

for (const reason of REASONS) {
  test(`${reason} triggers a redirection`, () => {
    const d = decide(warn(reason), createRedirectState());
    assert.deepEqual(d, { redirect: true, reason });
  });
}

test("a healthy loop is not a redirection and records nothing", () => {
  const d = decide({ action: "continue" }, createRedirectState());
  assert.deepEqual(d, { redirect: false });
});

test("a stop never redirects — the run is over, re-planning a corpse costs money", () => {
  const d = decide(
    { action: "stop", reason: "repeated_identical_tool" },
    createRedirectState(),
  );
  assert.deepEqual(d, { redirect: false });
});

test("max_iterations_reached is a budget, not a pathology", () => {
  const d = decide(warn("max_iterations_reached"), createRedirectState());
  assert.deepEqual(d, { redirect: false });
});

test("disabled records one skip per run, then goes quiet", () => {
  let state = createRedirectState();
  const first = decide(warn("no_progress"), state, 100, false);
  assert.deepEqual(first, { redirect: false, skip: "disabled" });

  state = noteDisabled(state);
  const second = decide(warn("no_progress"), state, 101, false);
  assert.deepEqual(
    second,
    { redirect: false },
    "no second line for the same run",
  );
});

test("the per-run cap stops the third redirection", () => {
  let state = createRedirectState();
  state = noteRedirect(state, "no_progress", 1);
  state = noteRedirect(state, "oscillation_detected", 10);
  assert.equal(state.used, REDIRECT_MAX_PER_RUN);

  const d = decide(warn("repeated_identical_tool"), state, 20);
  assert.deepEqual(d, { redirect: false, skip: "cap_reached" });
});

test("the same reason cannot fire twice — the advice would be the same", () => {
  const state = noteRedirect(createRedirectState(), "no_progress", 1);
  const d = decide(warn("no_progress"), state, 50);
  assert.deepEqual(d, { redirect: false, skip: "reason_used" });
});

test("a different reason may still fire after one redirection", () => {
  const state = noteRedirect(createRedirectState(), "no_progress", 1);
  const d = decide(warn("oscillation_detected"), state, 50);
  assert.deepEqual(d, { redirect: true, reason: "oscillation_detected" });
});

test("debounce: the model gets turns to act before being judged again", () => {
  const state = noteRedirect(createRedirectState(), "no_progress", 10);

  const tooSoon = decide(
    warn("oscillation_detected"),
    state,
    10 + REDIRECT_DEBOUNCE_TURNS - 1,
  );
  assert.deepEqual(tooSoon, { redirect: false, skip: "debounced" });

  const later = decide(
    warn("oscillation_detected"),
    state,
    10 + REDIRECT_DEBOUNCE_TURNS,
  );
  assert.equal(later.redirect, true);
});

test("maxPerRun 0 disables redirection through settings alone", () => {
  const d = decideRedirect({
    action: warn("no_progress"),
    turnCount: 5,
    state: createRedirectState(),
    enabled: true,
    maxPerRun: 0,
  });
  assert.deepEqual(d, { redirect: false, skip: "cap_reached" });
});

test("noteRedirect does not mutate the state it is given", () => {
  const before = createRedirectState();
  const after = noteRedirect(before, "no_progress", 7);
  assert.equal(before.used, 0);
  assert.deepEqual(before.reasonsUsed, []);
  assert.equal(after.used, 1);
  assert.equal(after.lastTurn, 7);
});
