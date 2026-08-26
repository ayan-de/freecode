import test from "node:test";
import assert from "node:assert/strict";
import { evaluateGate, majority, summarise } from "./gate.js";
import type { Baseline } from "./report.js";
import type { CaseResult, SuiteReport, TrialResult } from "./types.js";

const trial = (passed: boolean): TrialResult => ({
  passed,
  reason: passed ? "ok" : "nope",
  durationMs: 10,
  inputTokens: 100,
  outputTokens: 10,
});

function report(cases: CaseResult[]): SuiteReport {
  const blocking = cases.filter((c) => !c.quarantined);
  return {
    suite: "trajectory",
    ranAt: "2026-08-23T00:00:00Z",
    trials: 3,
    cases,
    passed: blocking.filter((c) => c.passed).length,
    total: blocking.length,
  };
}

const baseline = (passed: number, total: number, green: string[]): Baseline => ({
  passed,
  total,
  greenIds: new Set(green),
});

test("majority tolerates one unlucky trial out of three", () => {
  assert.equal(majority([trial(true), trial(true), trial(false)]), true);
  assert.equal(majority([trial(true), trial(false), trial(false)]), false);
});

test("majority of one trial is pass@1", () => {
  assert.equal(majority([trial(true)]), true);
  assert.equal(majority([trial(false)]), false);
  assert.equal(majority([]), false);
});

test("a case passing 2 of 3 is passed but not consistent", () => {
  const result = summarise("a", [trial(true), trial(true), trial(false)], false);
  assert.equal(result.passed, true);
  assert.equal(result.consistent, false);
});

test("first run has no baseline and records itself as run zero", () => {
  const verdict = evaluateGate(
    report([summarise("a", [trial(true)], false)]),
    null,
  );
  assert.equal(verdict.open, true);
  assert.match(verdict.reasons[0], /run zero/);
});

test("matching the baseline is green even when not everything passes", () => {
  // The whole point of gating on a delta: a suite still being curated is
  // usable, where an absolute 100% rule would be red forever.
  const cases = [
    summarise("a", [trial(true)], false),
    summarise("b", [trial(false)], false),
  ];
  const verdict = evaluateGate(report(cases), baseline(1, 2, ["a"]));
  assert.equal(verdict.open, true);
  assert.deepEqual(verdict.reasons, []);
});

test("dropping below the baseline pass count closes the gate", () => {
  const cases = [
    summarise("a", [trial(false)], false),
    summarise("b", [trial(false)], false),
  ];
  const verdict = evaluateGate(report(cases), baseline(2, 2, ["a", "b"]));
  assert.equal(verdict.open, false);
  assert.match(verdict.reasons.join(" "), /regression/);
});

test("a previously green case going red blocks even at equal totals", () => {
  // Without this clause a pure delta gate ratchets downward: lose one case,
  // gain another, and the count never notices.
  const cases = [
    summarise("a", [trial(false)], false),
    summarise("b", [trial(true)], false),
  ];
  const verdict = evaluateGate(report(cases), baseline(1, 2, ["a"]));
  assert.equal(verdict.open, false);
  assert.match(verdict.reasons.join(" "), /previously green.*a/);
});

test("quarantined cases never block and never count", () => {
  const cases = [
    summarise("a", [trial(true)], false),
    summarise("flaky", [trial(false)], true),
  ];
  const r = report(cases);
  assert.equal(r.total, 1);
  assert.equal(r.passed, 1);
  const verdict = evaluateGate(r, baseline(1, 1, ["a"]));
  assert.equal(verdict.open, true);
});

// --- judged cases (spec §7, §9.2) -----------------------------------------

const judgedTrial = (score: number | null, passed = true): TrialResult => ({
  ...trial(passed),
  score,
});

test("a judged case's verdict is its score against the floor, not majority", () => {
  const good = summarise("a", [judgedTrial(4)], false);
  assert.equal(good.passed, true);
  assert.equal(good.score, 4);

  const bad = summarise("b", [judgedTrial(1)], false);
  assert.equal(bad.passed, false);
  assert.equal(bad.score, 1);
});

test("a judged case's score is the mean of the trials the judge answered", () => {
  // An unanswered trial is EXCLUDED, not counted as zero — an outage must not
  // drag the mean down.
  const c = summarise("a", [judgedTrial(4), judgedTrial(2), judgedTrial(null)], false);
  assert.equal(c.score, 3);
});

test("an entirely unscored judged case passes", () => {
  // §7 constraint 3: a judge outage never fails a run.
  const c = summarise("a", [judgedTrial(null)], false);
  assert.equal(c.passed, true);
  assert.equal(c.score, null);
});

test("a deterministic case is untouched by any of this", () => {
  const c = summarise("a", [trial(true), trial(true), trial(false)], false);
  assert.equal(c.passed, true);
  assert.equal(c.score, undefined);
});

test("the judged gate blocks on a mean below 3.5", () => {
  const cases = [
    summarise("a", [judgedTrial(3)], false),
    summarise("b", [judgedTrial(3)], false),
  ];
  const verdict = evaluateGate(report(cases), baseline(2, 2, ["a", "b"]));
  assert.equal(verdict.open, false);
  assert.match(verdict.reasons.join(" "), /judged mean 3\.00\/5 below 3\.5/);
});

test("a single catastrophe blocks even when the mean is fine", () => {
  // The whole reason the floor exists: one 0/5 averages away behind four 5s.
  const cases = [
    summarise("a", [judgedTrial(5)], false),
    summarise("b", [judgedTrial(5)], false),
    summarise("c", [judgedTrial(5)], false),
    summarise("d", [judgedTrial(5)], false),
    summarise("bad", [judgedTrial(0)], false),
  ];
  const r = report(cases);
  const verdict = evaluateGate(r, baseline(4, 5, ["a", "b", "c", "d", "bad"]));
  assert.equal(verdict.open, false);
  assert.match(verdict.reasons.join(" "), /below the 2\/5 floor: bad/);
});

test("a healthy judged suite opens the gate", () => {
  const cases = [
    summarise("a", [judgedTrial(4)], false),
    summarise("b", [judgedTrial(5)], false),
  ];
  const verdict = evaluateGate(report(cases), baseline(2, 2, ["a", "b"]));
  assert.equal(verdict.open, true);
});

test("a judge outage leaves the gate open with nothing claimed", () => {
  const cases = [
    summarise("a", [judgedTrial(null)], false),
    summarise("b", [judgedTrial(null)], false),
  ];
  const verdict = evaluateGate(report(cases), baseline(2, 2, ["a", "b"]));
  assert.equal(verdict.open, true);
  assert.equal(
    verdict.reasons.some((r) => /judged/.test(r)),
    false,
  );
});

test("judged rules apply on run zero, where deterministic ones cannot", () => {
  // A rubric threshold is absolute: it does not get easier because there is no
  // history to compare against.
  const cases = [summarise("bad", [judgedTrial(0)], false)];
  const verdict = evaluateGate(report(cases), null);
  assert.equal(verdict.open, false);
  assert.match(verdict.reasons.join(" "), /below the 2\/5 floor/);
});

test("a quarantined judged case never blocks", () => {
  const cases = [
    summarise("a", [judgedTrial(5)], false),
    summarise("flaky", [judgedTrial(0)], true),
  ];
  const verdict = evaluateGate(report(cases), baseline(1, 1, ["a"]));
  assert.equal(verdict.open, true);
});
