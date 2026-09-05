import test, { afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { baselineFor, readHistory, writeReport } from "./report.js";
import type { CaseResult, SuiteReport } from "./types.js";

let home: string;
let prevHome: string | undefined;

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "freecode-eval-home-"));
  prevHome = process.env.FREECODE_EVAL_HOME;
  process.env.FREECODE_EVAL_HOME = home;
});

afterEach(() => {
  if (prevHome === undefined) delete process.env.FREECODE_EVAL_HOME;
  else process.env.FREECODE_EVAL_HOME = prevHome;
  fs.rmSync(home, { recursive: true, force: true });
});

const kase = (id: string, passed: boolean): CaseResult => ({
  id,
  trials: [],
  passed,
  consistent: passed,
  quarantined: false,
});

let clock = 0;
const report = (over: Partial<SuiteReport> = {}): SuiteReport => ({
  suite: "trajectory",
  ranAt: new Date(1_800_000_000_000 + clock++ * 1000).toISOString(),
  model: "anthropic/claude-sonnet-4-5",
  trials: 3,
  cases: [kase("a", true), kase("b", true)],
  passed: 2,
  total: 2,
  ...over,
});

test("a blocked run is recorded but never becomes the baseline", () => {
  // The bug this fixes: 18/20 -> 14/20 closes the gate, and re-running at
  // 14/20 opened it, because both the count and the green set came from the
  // failed run. The delta rule is only honest if a closed gate refuses to move
  // the bar it is measured against.
  writeReport(report({ passed: 2, total: 2 }));
  writeReport(
    report({
      passed: 1,
      total: 2,
      cases: [kase("a", true), kase("b", false)],
      gateBlocked: true,
    }),
  );

  const baseline = baselineFor("trajectory", "anthropic/claude-sonnet-4-5");
  assert.equal(baseline?.passed, 2, "baseline must be the last GREEN run");
  assert.equal(baseline?.greenIds.has("b"), true);

  // ...and the failed run is still in history, because the trend and
  // quarantine's pass rates both need it.
  assert.equal(readHistory("trajectory").length, 2);
});

test("several blocked runs in a row do not erode the baseline", () => {
  writeReport(report({ passed: 2, total: 2 }));
  for (let i = 0; i < 3; i++) {
    writeReport(report({ passed: 0, total: 2, gateBlocked: true }));
  }
  assert.equal(
    baselineFor("trajectory", "anthropic/claude-sonnet-4-5")?.passed,
    2,
  );
});

test("a baseline from a different model is refused", () => {
  // Comparing a cheap local run against a CI baseline from another model reads
  // as a regression with no way to see why.
  writeReport(report({ model: "openai/gpt-4o" }));
  assert.equal(baselineFor("trajectory", "anthropic/claude-sonnet-4-5"), null);
  assert.equal(baselineFor("trajectory", "openai/gpt-4o")?.passed, 2);
});

test("a baseline from the other auth mode is refused (OAuth spec §8)", () => {
  // The subscription endpoint sends a different beta set and an extra system
  // block, so an OAuth run is a different instrument — its numbers must not
  // become the bar an API-key run is measured against, in either direction.
  writeReport(report({ authMode: "oauth", passed: 2 }));
  assert.equal(baselineFor("trajectory", "anthropic/claude-sonnet-4-5"), null);
  assert.equal(
    baselineFor("trajectory", "anthropic/claude-sonnet-4-5", "oauth")?.passed,
    2,
  );

  writeReport(report({ passed: 1, total: 2 }));
  assert.equal(
    baselineFor("trajectory", "anthropic/claude-sonnet-4-5", "oauth")?.passed,
    2,
    "an API-key run must not overwrite the OAuth baseline",
  );
});

test("an untracked auth mode still matches an api-key run", () => {
  // Every baseline written before §8 landed has no authMode. Treating that as
  // a mismatch would throw away all of them.
  writeReport(report({ passed: 2 }));
  assert.equal(
    baselineFor("trajectory", "anthropic/claude-sonnet-4-5", "api-key")?.passed,
    2,
  );
});

test("the newest run on the SAME model wins over a newer one on another", () => {
  writeReport(report({ model: "anthropic/claude-sonnet-4-5", passed: 2 }));
  writeReport(report({ model: "openai/gpt-4o", passed: 0, total: 2 }));
  const baseline = baselineFor("trajectory", "anthropic/claude-sonnet-4-5");
  assert.equal(baseline?.passed, 2);
  assert.equal(baseline?.model, "anthropic/claude-sonnet-4-5");
});

test("a run recorded before models were tracked is still usable", () => {
  // Refusing it would throw away every baseline written before the field
  // existed, which would silently reset everyone's history to run zero.
  writeReport(report({ model: undefined }));
  assert.equal(
    baselineFor("trajectory", "anthropic/claude-sonnet-4-5")?.passed,
    2,
  );
});

test("asking without a model takes the last unblocked run of any model", () => {
  writeReport(report({ model: "openai/gpt-4o", passed: 1, total: 2 }));
  assert.equal(baselineFor("trajectory")?.passed, 1);
});

test("suites do not share a baseline", () => {
  writeReport(report({ suite: "trajectory", passed: 2 }));
  writeReport(report({ suite: "coding", passed: 0, total: 2 }));
  assert.equal(
    baselineFor("trajectory", "anthropic/claude-sonnet-4-5")?.passed,
    2,
  );
});

test("an accepted run becomes the baseline despite having failed", () => {
  // The escape hatch for a deliberately re-scoped suite: without it, deleting
  // cases makes `passed` drop, every later run reads as a regression, and the
  // baseline can never be superseded because it never opens.
  writeReport(report({ passed: 2, total: 2 }));
  writeReport(
    report({
      passed: 1,
      total: 1,
      cases: [kase("a", true)],
      baselineAccepted: true,
    }),
  );
  const baseline = baselineFor("trajectory", "anthropic/claude-sonnet-4-5");
  assert.equal(baseline?.passed, 1);
  assert.equal(baseline?.total, 1);
  assert.equal(baseline?.greenIds.has("b"), false);
});

test("acceptance is recorded, so history can tell it from an earned pass", () => {
  writeReport(report({ passed: 1, total: 2, baselineAccepted: true }));
  const [run] = readHistory("trajectory");
  assert.equal(run.baselineAccepted, true);
  // Not also marked blocked — that is what would have excluded it.
  assert.equal(run.gateBlocked, undefined);
});

test("no history at all is null, not a throw", () => {
  assert.equal(baselineFor("never-run"), null);
});

test("a truncated final line does not make history unreadable", () => {
  writeReport(report());
  fs.appendFileSync(
    path.join(home, "eval_runs.jsonl"),
    '{"suite":"trajectory","pass',
    "utf-8",
  );
  assert.equal(readHistory("trajectory").length, 1);
});
