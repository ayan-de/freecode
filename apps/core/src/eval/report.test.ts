import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { baselineFor, readHistory, reportDir, writeReport } from "./report.js";
import type { SuiteReport } from "./types.js";

function withHome<T>(fn: () => T): T {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fc-report-"));
  const prev = process.env.FREECODE_EVAL_HOME;
  process.env.FREECODE_EVAL_HOME = dir;
  try {
    return fn();
  } finally {
    if (prev === undefined) delete process.env.FREECODE_EVAL_HOME;
    else process.env.FREECODE_EVAL_HOME = prev;
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const report = (passed: number, ids: string[]): SuiteReport => ({
  suite: "trajectory",
  ranAt: new Date().toISOString(),
  trials: 1,
  cases: ids.map((id, i) => ({
    id,
    trials: [],
    passed: i < passed,
    consistent: i < passed,
    quarantined: false,
  })),
  passed,
  total: ids.length,
});

test("history accumulates while the latest verdict is overwritten", () => {
  withHome(() => {
    writeReport(report(1, ["a", "b"]));
    writeReport(report(2, ["a", "b"]));
    assert.equal(readHistory("trajectory").length, 2);
    const latest = JSON.parse(
      fs.readFileSync(path.join(reportDir(), "eval_report.json"), "utf-8"),
    );
    assert.equal(latest.passed, 2);
  });
});

test("baseline is the last run, not the best ever", () => {
  // Best-ever would ratchet a flaky suite permanently red.
  withHome(() => {
    writeReport(report(2, ["a", "b"]));
    writeReport(report(1, ["a", "b"]));
    const baseline = baselineFor("trajectory");
    assert.equal(baseline?.passed, 1);
    assert.deepEqual([...(baseline?.greenIds ?? [])], ["a"]);
  });
});

test("no history means no baseline", () => {
  withHome(() => assert.equal(baselineFor("trajectory"), null));
});

test("other suites do not contaminate the baseline", () => {
  withHome(() => {
    writeReport({ ...report(9, ["x"]), suite: "coding" });
    writeReport(report(1, ["a", "b"]));
    assert.equal(baselineFor("trajectory")?.passed, 1);
    assert.equal(baselineFor("coding")?.passed, 9);
  });
});

test("a truncated final line does not make the history unreadable", () => {
  // Killed mid-append. The trend matters more than the last row.
  withHome(() => {
    writeReport(report(2, ["a", "b"]));
    fs.appendFileSync(
      path.join(reportDir(), "eval_runs.jsonl"),
      '{"suite":"trajec',
      "utf-8",
    );
    assert.equal(readHistory("trajectory").length, 1);
  });
});
