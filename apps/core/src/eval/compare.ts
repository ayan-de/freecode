// =============================================================================
// A/B comparison of two suite reports — pure, so the criterion that decides a
// default flip is code rather than an argument.
//
// Spec `2026-08-26-trajectory-redirection.md` §9. The asymmetry is the point:
// the *candidate* has to earn the change. A metric that ties is fine; a metric
// that regresses is not, and "it felt better" is not a metric at all.
// =============================================================================

import type { SuiteReport, TrialResult } from "./types.js";

/** Token delta allowed on the standing suite before the flip is refused. §9 */
export const TOKEN_DELTA_LIMIT = 0.03;

export interface MetricSummary {
  passed: number;
  total: number;
  /** Summed over every trial of every case. */
  turns: number;
  repeatedCalls: number;
  tokens: number;
  redirects: number;
  redirectsSkipped: number;
  questionsRejected: number;
  trials: number;
  /**
   * Estimated USD, summed over priced trials only — `undefined` when nothing
   * in the run could be priced. Not 0 in that case: the whole point is telling
   * "this got cheaper" from "we cannot say" (spec §12.1).
   */
  costUsd?: number;
}

export interface ComparisonRow {
  metric: string;
  baseline: number;
  candidate: number;
  delta: number;
  /** Whether this row satisfies its criterion. `undefined` = reported only. */
  ok?: boolean;
  /** How to render the numbers. Absent = plain integer. */
  unit?: "usd";
}

export interface Comparison {
  suite: string;
  rows: ComparisonRow[];
  /** True when every gated row passes. */
  flip: boolean;
  reasons: string[];
}

const sum = (report: SuiteReport, pick: (t: TrialResult) => number): number =>
  report.cases.reduce(
    (n, c) => n + c.trials.reduce((m, t) => m + (pick(t) || 0), 0),
    0,
  );

export function summarise(report: SuiteReport): MetricSummary {
  return {
    passed: report.passed,
    total: report.total,
    turns: sum(report, (t) => t.turns),
    repeatedCalls: sum(report, (t) => t.repeatedCalls),
    tokens: sum(report, (t) => t.inputTokens + t.outputTokens),
    redirects: sum(report, (t) => t.redirects),
    redirectsSkipped: sum(report, (t) => t.redirectsSkipped),
    questionsRejected: sum(report, (t) => t.questionsRejected),
    trials: report.cases.reduce((n, c) => n + c.trials.length, 0),
    costUsd: totalCost(report),
  };
}

/** `undefined` unless at least one trial carried a price. */
function totalCost(report: SuiteReport): number | undefined {
  let usd = 0;
  let priced = false;
  for (const kase of report.cases) {
    for (const trial of kase.trials) {
      if (trial.costUsd === undefined) continue;
      usd += trial.costUsd;
      priced = true;
    }
  }
  return priced ? usd : undefined;
}

/**
 * `stuck` marks the redirect suite — the one where repetition is *supposed* to
 * fall, and the only place §9 gates on it. On the standing suite redirection
 * should barely fire, so demanding a repetition drop there would gate on noise.
 */
export function compareReports(
  baseline: SuiteReport,
  candidate: SuiteReport,
  opts: { stuck?: boolean } = {},
): Comparison {
  const a = summarise(baseline);
  const b = summarise(candidate);
  const reasons: string[] = [];

  const passOk = b.passed >= a.passed;
  if (!passOk) {
    reasons.push(
      `pass rate fell: ${b.passed}/${b.total} vs ${a.passed}/${a.total}`,
    );
  }

  // Tokens: the candidate is allowed to cost the supervisor, and no more.
  const tokenDelta = a.tokens === 0 ? 0 : (b.tokens - a.tokens) / a.tokens;
  const tokensOk = tokenDelta <= TOKEN_DELTA_LIMIT;
  if (!tokensOk) {
    reasons.push(
      `tokens up ${(tokenDelta * 100).toFixed(1)}%, over the ${(TOKEN_DELTA_LIMIT * 100).toFixed(0)}% budget`,
    );
  }

  const turnsOk = b.turns <= a.turns;
  if (!turnsOk) {
    reasons.push(`turns up: ${b.turns} vs ${a.turns}`);
  }

  // Only gated on the stuck suite (§9). Elsewhere it is reported.
  const repeatsOk = opts.stuck ? b.repeatedCalls < a.repeatedCalls : undefined;
  if (repeatsOk === false) {
    reasons.push(
      `repeated tool calls not reduced: ${b.repeatedCalls} vs ${a.repeatedCalls}`,
    );
  }

  // A run in which the feature never fired proves nothing either way, and
  // "green because nothing happened" is the most expensive false positive here.
  if (opts.stuck && b.redirects === 0) {
    reasons.push(
      "no redirection fired — the suite did not exercise the feature",
    );
  }

  const rows: ComparisonRow[] = [
    {
      metric: "cases passed",
      baseline: a.passed,
      candidate: b.passed,
      delta: b.passed - a.passed,
      ok: passOk,
    },
    {
      metric: "tokens",
      baseline: a.tokens,
      candidate: b.tokens,
      delta: b.tokens - a.tokens,
      ok: tokensOk,
    },
    {
      metric: "turns",
      baseline: a.turns,
      candidate: b.turns,
      delta: b.turns - a.turns,
      ok: turnsOk,
    },
    {
      metric: "repeated calls",
      baseline: a.repeatedCalls,
      candidate: b.repeatedCalls,
      delta: b.repeatedCalls - a.repeatedCalls,
      ...(repeatsOk === undefined ? {} : { ok: repeatsOk }),
    },
    {
      metric: "redirects fired",
      baseline: a.redirects,
      candidate: b.redirects,
      delta: b.redirects - a.redirects,
    },
    {
      metric: "warnings skipped",
      baseline: a.redirectsSkipped,
      candidate: b.redirectsSkipped,
      delta: b.redirectsSkipped - a.redirectsSkipped,
    },
    {
      metric: "questions declined",
      baseline: a.questionsRejected,
      candidate: b.questionsRejected,
      delta: b.questionsRejected - a.questionsRejected,
    },
    // Reported, never gated. `tokens` is already the gated efficiency metric
    // and it is the one under the harness's control; cost also moves when a
    // provider reprices, which is not a regression in anything this suite is
    // measuring. Omitted entirely when either side is unpriced — a comparison
    // against an unknown is not a comparison.
    ...(a.costUsd !== undefined && b.costUsd !== undefined
      ? [
          {
            metric: "cost (est.)",
            baseline: a.costUsd,
            candidate: b.costUsd,
            delta: b.costUsd - a.costUsd,
            unit: "usd" as const,
          },
        ]
      : []),
  ];

  return {
    suite: candidate.suite,
    rows,
    flip: reasons.length === 0,
    reasons,
  };
}
