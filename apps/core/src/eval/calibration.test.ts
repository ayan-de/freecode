import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  calibrationReport,
  cohenKappa,
  loadCalibrationSamples,
  recordCalibrationSample,
  type CalibrationSample,
} from "./calibration.js";

const sample = (
  overrides: Partial<CalibrationSample> = {},
): CalibrationSample => ({
  caseId: "case-1",
  rubric: "quality",
  ranAt: "2026-09-05T00:00:00.000Z",
  model: "gemini/g",
  judge: { provider: "openai", model: "o" },
  judgeScore: 4,
  judgeReason: "fine",
  prompt: "do the thing",
  response: "did the thing",
  tools: "read (x2)",
  human: null,
  ...overrides,
});

function withEvalsDir<T>(fn: () => T): T {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fc-calibration-"));
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

// --- kappa ------------------------------------------------------------------

test("kappa is 1 on perfect agreement with both classes present", () => {
  assert.equal(
    cohenKappa([
      { a: true, b: true },
      { a: false, b: false },
    ]),
    1,
  );
});

test("kappa is negative on systematic disagreement", () => {
  const k = cohenKappa([
    { a: true, b: false },
    { a: false, b: true },
  ]);
  assert.ok(k !== null && k < 0);
});

test("kappa is null when both raters are constant — undefined, not perfect", () => {
  assert.equal(
    cohenKappa([
      { a: true, b: true },
      { a: true, b: true },
    ]),
    null,
  );
  assert.equal(cohenKappa([]), null);
});

test("kappa is near 0 at chance-level agreement", () => {
  // Rater a alternates independently of b: agreement equals chance.
  const pairs = [
    { a: true, b: true },
    { a: true, b: false },
    { a: false, b: true },
    { a: false, b: false },
  ];
  assert.equal(cohenKappa(pairs), 0);
});

// --- report -----------------------------------------------------------------

test("report splits labelled from unlabelled and scores per threshold", () => {
  const samples = [
    sample({ judgeScore: 5, human: true }),
    sample({ caseId: "case-2", judgeScore: 1, human: false }),
    sample({ caseId: "case-3", judgeScore: 3, human: null }),
  ];
  const report = calibrationReport(samples);
  assert.equal(report.total, 3);
  assert.equal(report.labeled, 2);
  assert.equal(report.unlabeled, 1);
  assert.equal(report.humanPassRate, 0.5);
  assert.equal(report.rows.length, 5);
  // At every cut between 1 and 5 the judge separates these two perfectly.
  const cut3 = report.rows.find((r) => r.threshold === 3)!;
  assert.equal(cut3.accuracy, 1);
  assert.equal(cut3.kappa, 1);
  assert.equal(cut3.failPrecision, 1);
  assert.equal(cut3.failRecall, 1);
});

test("fail precision/recall are null, never NaN, when a class is empty", () => {
  const report = calibrationReport([sample({ judgeScore: 5, human: true })]);
  const cut1 = report.rows.find((r) => r.threshold === 1)!;
  assert.equal(cut1.failPrecision, null); // judge failed nothing
  assert.equal(cut1.failRecall, null); // human failed nothing
});

// --- record + load ----------------------------------------------------------

test("record appends, dedupes on case+response, and load round-trips", () => {
  withEvalsDir(() => {
    assert.equal(recordCalibrationSample(sample()), true);
    // Same case, same response — a re-run must not queue it twice.
    assert.equal(recordCalibrationSample(sample({ judgeScore: 2 })), false);
    // Same case, different response — a genuinely new reply to label.
    assert.equal(
      recordCalibrationSample(sample({ response: "did it differently" })),
      true,
    );
    const loaded = loadCalibrationSamples();
    assert.equal(loaded.length, 2);
    assert.equal(loaded[0].judgeScore, 4);
  });
});

test("load reports the file and line on a malformed sample", () => {
  withEvalsDir(() => {
    recordCalibrationSample(sample());
    const file = path.join(
      process.env.FREECODE_EVALS_DIR!,
      "calibration",
      "samples.jsonl",
    );
    fs.appendFileSync(file, "not json\n", "utf-8");
    assert.throws(() => loadCalibrationSamples(), /samples\.jsonl:2/);
  });
});

test("load rejects a label that is neither boolean nor null", () => {
  withEvalsDir(() => {
    const file = path.join(
      process.env.FREECODE_EVALS_DIR!,
      "calibration",
      "samples.jsonl",
    );
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(
      file,
      `${JSON.stringify({ ...sample(), human: "yes" })}\n`,
      "utf-8",
    );
    assert.throws(() => loadCalibrationSamples(), /must be true, false or null/);
  });
});

test("loading a missing file is empty, not an error", () => {
  withEvalsDir(() => {
    assert.deepEqual(loadCalibrationSamples(), []);
  });
});
