import test from "node:test";
import assert from "node:assert/strict";
import { compareReports, summarise, TOKEN_DELTA_LIMIT } from "./compare.js";
import type { SuiteReport, TrialResult } from "./types.js";

function trial(over: Partial<TrialResult> = {}): TrialResult {
  return {
    passed: true,
    reason: "ok",
    durationMs: 100,
    inputTokens: 1000,
    outputTokens: 100,
    turns: 3,
    repeatedCalls: 0,
    redirects: 0,
    redirectsSkipped: 0,
    questionsRejected: 0,
    ...over,
  };
}

function report(trials: TrialResult[], passed = trials.length): SuiteReport {
  return {
    suite: "redirect",
    ranAt: new Date().toISOString(),
    trials: 1,
    cases: trials.map((t, i) => ({
      id: `c${i}`,
      trials: [t],
      passed: t.passed,
      consistent: t.passed,
      quarantined: false,
    })),
    passed,
    total: trials.length,
  };
}

test("summarise sums every trial of every case", () => {
  const s = summarise(report([trial(), trial({ turns: 5, repeatedCalls: 2 })]));
  assert.equal(s.turns, 8);
  assert.equal(s.repeatedCalls, 2);
  assert.equal(s.tokens, 2200);
  assert.equal(s.trials, 2);
});

test("a candidate that reduces repetition on the stuck suite flips", () => {
  // Baseline big enough that one supervisor call fits the 3% budget — which
  // is the real-world shape: the supervisor is ~1 call against a whole run.
  const before = report([
    trial({ repeatedCalls: 6, turns: 8, inputTokens: 100_000 }),
  ]);
  const after = report([
    trial({
      repeatedCalls: 1,
      turns: 6,
      redirects: 1,
      inputTokens: 100_000,
      outputTokens: 140,
    }),
  ]);
  const c = compareReports(before, after, { stuck: true });
  assert.equal(c.flip, true, c.reasons.join("; "));
});

test("no redirection firing is not a pass, however green the numbers", () => {
  const before = report([trial({ repeatedCalls: 6 })]);
  const after = report([trial({ repeatedCalls: 1, redirects: 0 })]);
  const c = compareReports(before, after, { stuck: true });
  assert.equal(c.flip, false);
  assert.match(c.reasons.join(), /did not exercise the feature/);
});

test("a pass-rate regression blocks the flip", () => {
  const before = report([trial(), trial()], 2);
  const after = report(
    [trial(), trial({ passed: false, redirects: 1, repeatedCalls: 0 })],
    1,
  );
  const c = compareReports(before, after, { stuck: true });
  assert.equal(c.flip, false);
  assert.match(c.reasons.join(), /pass rate fell/);
});

// §9 budgets tokens on the STANDING suite, so this is checked without
// `stuck` — there, redirection barely fires and cost is the whole question.
test("tokens may rise by the supervisor's cost but no further", () => {
  const before = report([trial({ inputTokens: 10_000, outputTokens: 0 })]);

  // Exactly +3%. Written as an integer because token counts are integers;
  // computing it as 10_000 * 0.03 lands a hair over the limit in binary.
  const withinBudget = report([
    trial({
      inputTokens: 10_300,
      outputTokens: 0,
      redirects: 1,
      repeatedCalls: 0,
    }),
  ]);
  assert.equal(
    compareReports(before, withinBudget).flip,
    true,
    "exactly at the limit is allowed",
  );

  const overBudget = report([
    trial({
      inputTokens: 20_000,
      outputTokens: 0,
      redirects: 1,
      repeatedCalls: 0,
    }),
  ]);
  const c = compareReports(before, overBudget);
  assert.equal(c.flip, false);
  assert.match(c.reasons.join(), /tokens up/);
});

test("more turns blocks the flip — advice is meant to shorten the run", () => {
  const before = report([trial({ turns: 4, repeatedCalls: 3 })]);
  const after = report([trial({ turns: 9, repeatedCalls: 0, redirects: 1 })]);
  const c = compareReports(before, after, { stuck: true });
  assert.equal(c.flip, false);
  assert.match(c.reasons.join(), /turns up/);
});

test("repetition is gated only on the stuck suite", () => {
  const before = report([trial({ repeatedCalls: 1 })]);
  const after = report([trial({ repeatedCalls: 1 })]);

  // Standing suite: unchanged repetition is fine, and redirection need not fire.
  const standing = compareReports(before, after);
  assert.equal(standing.flip, true);
  assert.equal(
    standing.rows.find((r) => r.metric === "repeated calls")?.ok,
    undefined,
    "reported, not gated",
  );

  // Stuck suite: unchanged repetition means the feature did nothing.
  const stuck = compareReports(before, after, { stuck: true });
  assert.equal(stuck.flip, false);
  assert.match(stuck.reasons.join(), /not reduced/);
});

test("an empty baseline does not divide by zero", () => {
  const before = report([trial({ inputTokens: 0, outputTokens: 0, turns: 0 })]);
  const after = report([
    trial({
      inputTokens: 0,
      outputTokens: 0,
      turns: 0,
      redirects: 1,
      repeatedCalls: -1,
    }),
  ]);
  const c = compareReports(before, after, { stuck: true });
  assert.ok(Number.isFinite(c.rows[1].delta));
});
