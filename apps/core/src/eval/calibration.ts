// =============================================================================
// Judge calibration — measure the judge against a human, per Cohen's kappa.
//
// The judged suite gates releases on a judge whose agreement with a human has
// never been measured (EVAL.md's own admission: "Nobody should trust a judge
// that has never been audited"). This closes that loop in two halves:
//
// 1. CAPTURE: every judged trial that got a numeric verdict is appended to
//    `evals/calibration/samples.jsonl` with `human: null` — the response text,
//    which `TrialResult` deliberately never carries, is persisted here and
//    nowhere else, precisely so a human has something to grade after the run.
// 2. REPORT: `freecode eval calibrate` reads the labelled samples and prints
//    judge-vs-human agreement at every score threshold.
//
// Labels are BINARY on purpose (pass/fail, not 0–5): a human re-deriving the
// judge's numeric scale is calibrating themselves to the judge, which is the
// wrong direction. The report maps the judge's 0–5 onto pass/fail at each
// possible cut and shows where the agreement lives; the gate's operative cut
// (`JUDGE_CASE_FLOOR`) is the row that matters.
// =============================================================================

import * as fs from "fs";
import * as path from "path";
import { evalsDir } from "./dataset.js";

/** One graded trial, awaiting (or carrying) a human verdict. */
export interface CalibrationSample {
  /** Case id the trial ran. */
  caseId: string;
  /** Rubric the judge graded against — agreement can differ per rubric. */
  rubric: string;
  ranAt: string;
  sessionId?: string;
  /** Subject `provider/model`, so a label set spans model bumps legibly. */
  model: string;
  judge: { provider: string; model?: string };
  judgeScore: number;
  judgeReason: string;
  prompt: string;
  response: string;
  /** The deduplicated tool list the judge was shown, as ground truth. */
  tools: string;
  /** The human verdict. `null` until someone edits it to true/false. */
  human: boolean | null;
}

export function calibrationPath(): string {
  return path.join(evalsDir(), "calibration", "samples.jsonl");
}

/**
 * Append one sample, unless an existing sample already carries the same case
 * and response text — re-running a suite must not queue the identical reply
 * for labelling twice, and must never clobber a label already given.
 * Returns whether it wrote.
 */
export function recordCalibrationSample(
  sample: CalibrationSample,
): boolean {
  const file = calibrationPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (fs.existsSync(file)) {
    const existing = loadCalibrationSamples();
    if (
      existing.some(
        (s) => s.caseId === sample.caseId && s.response === sample.response,
      )
    ) {
      return false;
    }
  }
  fs.appendFileSync(file, `${JSON.stringify(sample)}\n`, "utf-8");
  return true;
}

export function loadCalibrationSamples(): CalibrationSample[] {
  const file = calibrationPath();
  if (!fs.existsSync(file)) return [];
  const samples: CalibrationSample[] = [];
  const lines = fs.readFileSync(file, "utf-8").split("\n");
  for (const [index, line] of lines.entries()) {
    if (!line.trim()) continue;
    let parsed: CalibrationSample;
    try {
      parsed = JSON.parse(line) as CalibrationSample;
    } catch {
      throw new Error(`${file}:${index + 1}: not valid JSON`);
    }
    if (typeof parsed.human !== "boolean" && parsed.human !== null) {
      throw new Error(
        `${file}:${index + 1}: \`human\` must be true, false or null`,
      );
    }
    samples.push(parsed);
  }
  return samples;
}

/**
 * Cohen's kappa over paired binary verdicts. `null` when chance agreement is
 * total (both raters constant), where kappa is undefined — reported as such
 * rather than as 0 or 1, because "every sample passed for both" says nothing
 * about whether the judge can recognise a failure.
 */
export function cohenKappa(
  pairs: Array<{ a: boolean; b: boolean }>,
): number | null {
  const n = pairs.length;
  if (n === 0) return null;
  const agree = pairs.filter((p) => p.a === p.b).length / n;
  const aPass = pairs.filter((p) => p.a).length / n;
  const bPass = pairs.filter((p) => p.b).length / n;
  const chance = aPass * bPass + (1 - aPass) * (1 - bPass);
  if (chance === 1) return null;
  return (agree - chance) / (1 - chance);
}

/** Agreement at one cut: the judge "passes" a sample iff score >= threshold. */
export interface ThresholdRow {
  threshold: number;
  /** Fraction of labelled samples where judge and human agree. */
  accuracy: number;
  /**
   * Of the samples the judge FAILED, how many the human also failed. The
   * judge-as-failure-detector view — a low value means red judged cases are
   * mostly noise.
   */
  failPrecision: number | null;
  /** Of the samples the human failed, how many the judge caught. */
  failRecall: number | null;
  kappa: number | null;
}

export interface CalibrationReport {
  total: number;
  labeled: number;
  unlabeled: number;
  humanPassRate: number | null;
  rows: ThresholdRow[];
}

export function calibrationReport(
  samples: CalibrationSample[],
): CalibrationReport {
  const labeled = samples.filter(
    (s): s is CalibrationSample & { human: boolean } =>
      typeof s.human === "boolean",
  );
  const rows: ThresholdRow[] = [];
  for (let threshold = 1; threshold <= 5; threshold++) {
    const pairs = labeled.map((s) => ({
      a: s.judgeScore >= threshold,
      b: s.human,
    }));
    const judgeFailed = pairs.filter((p) => !p.a);
    const humanFailed = pairs.filter((p) => !p.b);
    rows.push({
      threshold,
      accuracy:
        pairs.length === 0
          ? 0
          : pairs.filter((p) => p.a === p.b).length / pairs.length,
      failPrecision:
        judgeFailed.length === 0
          ? null
          : judgeFailed.filter((p) => !p.b).length / judgeFailed.length,
      failRecall:
        humanFailed.length === 0
          ? null
          : humanFailed.filter((p) => !p.a).length / humanFailed.length,
      kappa: cohenKappa(pairs),
    });
  }
  return {
    total: samples.length,
    labeled: labeled.length,
    unlabeled: samples.length - labeled.length,
    humanPassRate:
      labeled.length === 0
        ? null
        : labeled.filter((s) => s.human).length / labeled.length,
    rows,
  };
}
