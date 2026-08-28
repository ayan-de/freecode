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
import { compareEfficiency, suiteEfficiency } from "./scorers/efficiency.js";
import type { CaseResult, SuiteReport, TrialResult } from "./types.js";

export interface Verdict {
  open: boolean;
  reasons: string[];
  /**
   * Reported, never blocking (§9.2's efficiency row). Kept in a separate field
   * from `reasons` precisely so it CANNOT be folded into `open` by accident:
   * the one thing a warn-only rule must never do is grow into a gate.
   */
  warnings: string[];
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

/**
 * Judged-suite thresholds, spec §9.2.
 *
 * The FLOOR is the part that earns its keep: a mean hides catastrophes. One
 * 0/5 disaster averages away behind four 5s and ships. Mean measures the
 * suite; the floor measures the worst case, and for a release gate the worst
 * case is the one that matters.
 */
export const JUDGE_MEAN_FLOOR = 3.5;
export const JUDGE_CASE_FLOOR = 2;

/** Mean of the trials the judge actually answered for; null if it answered none. */
export function meanScore(trials: TrialResult[]): number | null {
  const scored = trials
    .map((t) => t.score)
    .filter((s): s is number => typeof s === "number");
  if (scored.length === 0) return null;
  return scored.reduce((a, b) => a + b, 0) / scored.length;
}

export function summarise(
  id: string,
  trials: TrialResult[],
  quarantined: boolean,
): CaseResult {
  // A judged case is one whose trials carry a `score` field at all — present
  // and null still means "judged, unanswered", which is not the same as
  // "deterministic".
  const judged = trials.some((t) => t.score !== undefined);
  const score = judged ? meanScore(trials) : undefined;

  return {
    id,
    trials,
    // A judged case's verdict is its floor, not majority-of-N: the trials
    // produce a number, not a boolean, and averaging is how a rubric is meant
    // to be read.
    //
    // An UNSCORED judged case falls back to the DETERMINISTIC verdict, not to
    // `true`. Returning true unconditionally was how a judge outage kept its
    // promise (§7 constraint 3) — but "the judge did not answer" and "the case
    // never got far enough to ask" arrive here identically, as `score: null`,
    // so a case that crashed or called a forbidden tool reported PASS on the
    // strength of the grader not having run. `majority(trials)` keeps the
    // promise and drops the bug: an outage on a case whose trials passed is
    // still a pass, and a case whose trials failed is still a failure.
    passed:
      judged && typeof score === "number"
        ? score >= JUDGE_CASE_FLOOR
        : majority(trials),
    consistent: trials.length > 0 && trials.every((t) => t.passed),
    quarantined,
    ...(judged ? { score } : {}),
  };
}

export function evaluateGate(
  report: SuiteReport,
  baseline: Baseline | null,
): Verdict {
  const reasons: string[] = [];
  const blocking = report.cases.filter((c) => !c.quarantined);

  // 0. Efficiency (§9.2). Computed first so it is reported even when the run is
  //    blocked for another reason — a regression that got slower AND worse
  //    should say both. Never contributes to `open`.
  const warnings = baseline
    ? compareEfficiency(baseline.efficiency, suiteEfficiency(report))
    : [];

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

  // 3. Judged cases, on their own rule (§9.2). Unlike the deterministic rules
  //    these are ABSOLUTE, not deltas: a rubric threshold is a statement about
  //    quality that does not get easier because last week was bad. They are
  //    also evaluated even with no baseline, for the same reason.
  const judgedReasons = evaluateJudged(report);
  reasons.push(...judgedReasons);

  // 4. With no history there is nothing to compare the DETERMINISTIC counts
  //    against. Record the run as the baseline and say so — inventing a
  //    threshold there would be a number with no evidence behind it. The
  //    judged rules survive, because they never needed a baseline.
  //
  //    One exception, and it is not a threshold: a run where NOTHING passed.
  //    Refusing to invent a bar does not oblige the gate to call a total
  //    wipeout releasable, and "0/20, run zero, GATE OPEN — safe to release"
  //    is the same always-says-yes failure as an ungraded judged suite. A
  //    suite in which no case passed is a broken suite or a broken agent; in
  //    either case it is not a baseline worth recording.
  if (!baseline) {
    const wipeout = report.total > 0 && report.passed === 0;
    const zeroReasons = [
      `no baseline yet — recorded ${report.passed}/${report.total} as run zero`,
      ...judgedReasons,
      ...(wipeout
        ? [`no case passed — run zero is not a baseline worth recording`]
        : []),
    ];
    return { open: !wipeout && judgedReasons.length === 0, reasons: zeroReasons, warnings };
  }

  return { open: reasons.length === 0, reasons, warnings };
}

/**
 * `mean >= 3.5/5 AND no single case below 2/5`, over blocking judged cases.
 *
 * Cases the judge could not answer for are EXCLUDED from both statistics
 * rather than counted as zero. Counting an outage as a zero would let a
 * third-party 429 close a release gate, which is exactly the failure §7
 * constraint 3 forbids — and it would drag the mean down in the most
 * confusing possible way.
 */
function evaluateJudged(report: SuiteReport): string[] {
  const judged = report.cases.filter(
    (c) => !c.quarantined && c.score !== undefined,
  );
  if (judged.length === 0) return [];

  // A judge that was NEVER CONFIGURED is not an outage — it is a suite that
  // did not run. Those are different events and used to be treated the same.
  //
  // `judgeSkipped` is set on exactly one path: `resolveJudge` returning
  // `unconfigured` (suite.ts). A judge that WAS configured and then timed out
  // or 429'd leaves it undefined and arrives below as a null score. That is the
  // whole distinction this rule rests on — an outage must never fail a run (§7
  // constraint 3), but a missing env var must never silently pass one either.
  //
  // Before this, forgetting FREECODE_JUDGE_PROVIDER reported every judged case
  // as skipped and printed GATE OPEN: a release ritual that always says yes,
  // which is worse than no ritual because it is trusted.
  if (report.judgeSkipped) {
    return [`judged suite ran with no judge — ${report.judgeSkipped}`];
  }

  const scored = judged.filter(
    (c): c is CaseResult & { score: number } => typeof c.score === "number",
  );
  if (scored.length === 0) {
    // Reported, not blocking: nothing was measured, so nothing can be claimed.
    return [];
  }

  const reasons: string[] = [];
  const mean = scored.reduce((n, c) => n + c.score, 0) / scored.length;
  if (mean < JUDGE_MEAN_FLOOR) {
    reasons.push(
      `judged mean ${mean.toFixed(2)}/5 below ${JUDGE_MEAN_FLOOR}`,
    );
  }
  const below = scored.filter((c) => c.score < JUDGE_CASE_FLOOR);
  if (below.length > 0) {
    reasons.push(
      `below the ${JUDGE_CASE_FLOOR}/5 floor: ` +
        below.map((c) => `${c.id} (${c.score.toFixed(1)})`).join(", "),
    );
  }
  return reasons;
}
