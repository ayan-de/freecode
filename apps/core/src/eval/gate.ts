// =============================================================================
// Gate — spec §9.2. Pure: takes a finished report and a baseline, returns a
// verdict. No IO, so every rule below is testable without spending a token.
//
// Why not "100% must pass": at a true per-trial pass rate of 0.93 across 20
// cases, requiring all 3 trials of every case to pass is green ~1.3% of the
// time on a HEALTHY system. A signal that fires on healthy runs teaches the
// team to ignore it. See §9.1 for the full table.
// =============================================================================

import type { Baseline } from "./report.js";
import type { CaseResult, SuiteReport, TrialResult } from "./types.js";

export interface Verdict {
  open: boolean;
  reasons: string[];
}

/**
 * Majority-of-N. With one trial this is pass@1; with three it tolerates a
 * single unlucky trial, which is the difference between a gate that runs and
 * a gate that gets disabled.
 */
export function majority(trials: TrialResult[]): boolean {
  if (trials.length === 0) return false;
  const passed = trials.filter((t) => t.passed).length;
  return passed * 2 > trials.length;
}

export function summarise(
  id: string,
  trials: TrialResult[],
  quarantined: boolean,
): CaseResult {
  return {
    id,
    trials,
    passed: majority(trials),
    consistent: trials.length > 0 && trials.every((t) => t.passed),
    quarantined,
  };
}

export function evaluateGate(
  report: SuiteReport,
  baseline: Baseline | null,
): Verdict {
  const reasons: string[] = [];
  const blocking = report.cases.filter((c) => !c.quarantined);

  // 1. Regression against the last recorded run. Gating on a delta rather than
  //    an absolute is what makes the suite usable while cases are still being
  //    curated: matching last week's 18/20 is green, dropping to 14/20 is not.
  if (baseline && report.passed < baseline.passed) {
    reasons.push(
      `regression: ${report.passed}/${report.total} vs baseline ${baseline.passed}/${baseline.total}`,
    );
  }

  // 2. A case that was green and is now red is a hard block regardless of the
  //    totals. Without this a pure delta gate ratchets downward: lose one case,
  //    gain another, and the count never notices.
  if (baseline) {
    const regressed = blocking
      .filter((c) => !c.passed && baseline.greenIds.has(c.id))
      .map((c) => c.id);
    if (regressed.length > 0) {
      reasons.push(`previously green, now failing: ${regressed.join(", ")}`);
    }
  }

  // 3. With no history there is nothing to compare against. Record the run as
  //    the baseline and say so — inventing a threshold here would be a number
  //    with no evidence behind it.
  if (!baseline) {
    reasons.length = 0;
    return {
      open: true,
      reasons: [
        `no baseline yet — recorded ${report.passed}/${report.total} as run zero`,
      ],
    };
  }

  return { open: reasons.length === 0, reasons };
}
