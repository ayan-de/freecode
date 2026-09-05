import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type { AbReport } from "./ab-run.js";
import {
  loadExperiments,
  recordExperiment,
} from "./experiments.js";

const tally = (passed: number, over: Partial<{ costUsd: number }> = {}) => ({
  passed,
  ran: 3,
  turns: 4,
  repeatedCalls: 1,
  tokens: 100,
  ...over,
});

const report = (overrides: Partial<AbReport> = {}): AbReport => ({
  suite: "redirect",
  ranAt: "2026-09-05T12:00:00.000Z",
  trials: 3,
  sides: { baseline: {}, candidate: { "env:X": "1" } },
  commit: "abc1234",
  served: { baseline: [], candidate: [] },
  cases: [
    {
      id: "a",
      delta: "improved",
      baseline: tally(1),
      candidate: tally(3, { costUsd: 0.01 }),
    },
    {
      id: "b",
      delta: "unchanged-pass",
      baseline: tally(3),
      candidate: tally(3, { costUsd: 0.02 }),
    },
  ],
  ...overrides,
});

function withEvalsDir<T>(fn: () => T): T {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fc-experiments-"));
  const prev = process.env.FREECODE_EVALS_DIR;
  process.env.FREECODE_EVALS_DIR = dir;
  try {
    return fn();
  } finally {
    if (prev === undefined) delete process.env.FREECODE_EVALS_DIR;
    else process.env.FREECODE_EVALS_DIR = prev;
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test("record folds deltas and per-side totals, awaiting a verdict", () => {
  withEvalsDir(() => {
    const rec = recordExperiment("caching should cut tokens", report());
    assert.equal(rec.id, "2026-09-05-redirect-1");
    assert.equal(rec.verdict, null);
    assert.equal(rec.commit, "abc1234");
    assert.deepEqual(rec.deltas, { improved: 1, "unchanged-pass": 1 });
    assert.equal(rec.totals.baseline.passed, 4);
    assert.equal(rec.totals.candidate.passed, 6);
    assert.equal(rec.totals.baseline.tokens, 200);
    // Unpriced baseline stays undefined — "free" and "unknown" distinct.
    assert.equal(rec.totals.baseline.costUsd, undefined);
    assert.ok(Math.abs((rec.totals.candidate.costUsd ?? 0) - 0.03) < 1e-9);
  });
});

test("ids count up within the same day and suite, not across", () => {
  withEvalsDir(() => {
    recordExperiment("h1", report());
    const second = recordExperiment("h2", report());
    assert.equal(second.id, "2026-09-05-redirect-2");
    const otherSuite = recordExperiment("h3", report({ suite: "trajectory" }));
    assert.equal(otherSuite.id, "2026-09-05-trajectory-1");
    const otherDay = recordExperiment(
      "h4",
      report({ ranAt: "2026-09-06T09:00:00.000Z" }),
    );
    assert.equal(otherDay.id, "2026-09-06-redirect-1");
  });
});

test("load round-trips and accepts an edited-in verdict and note", () => {
  withEvalsDir(() => {
    recordExperiment("h", report());
    const file = path.join(
      process.env.FREECODE_EVALS_DIR!,
      "experiments.jsonl",
    );
    const edited = fs
      .readFileSync(file, "utf-8")
      .replace('"verdict":null', '"verdict":"rejected","note":"noise"');
    fs.writeFileSync(file, edited, "utf-8");
    const [rec] = loadExperiments();
    assert.equal(rec.verdict, "rejected");
    assert.equal(rec.note, "noise");
  });
});

test("load rejects a verdict outside kept/rejected/null", () => {
  withEvalsDir(() => {
    recordExperiment("h", report());
    const file = path.join(
      process.env.FREECODE_EVALS_DIR!,
      "experiments.jsonl",
    );
    fs.writeFileSync(
      file,
      fs.readFileSync(file, "utf-8").replace('"verdict":null', '"verdict":"maybe"'),
      "utf-8",
    );
    assert.throws(() => loadExperiments(), /must be "kept", "rejected" or null/);
  });
});

test("a missing ledger is empty, not an error", () => {
  withEvalsDir(() => {
    assert.deepEqual(loadExperiments(), []);
  });
});
