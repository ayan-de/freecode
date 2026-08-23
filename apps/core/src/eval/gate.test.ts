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
