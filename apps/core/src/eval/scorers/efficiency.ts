// =============================================================================
// Efficiency scorer — spec §5 (architecture) and §9.2 (the "warn only" row).
//
// The odd one out among the scorers, and deliberately so: it does not implement
// `Scorer`. A `Scorer` returns pass/fail for ONE trial against ONE case, and
// efficiency is neither — it is an aggregate of a whole run compared against a
// recorded baseline. Forcing it into the signature would give it a `passed`
// field, and a `passed` field is a thing gates block on. §9.2 says warn only.
//
// Why warn only, restated because it is the whole design: this number moves
// when the SUITE changes (a case added, a case quarantined, `--trials` raised)
// exactly as readily as when the AGENT changes, and nothing at this level can
// tell those apart — the same limitation that made `--accept-baseline` a flag
// rather than a heuristic. A number that cannot distinguish its own causes may
// inform a human; it may not close a gate.
// =============================================================================

import type { Trace } from "../../rollout/trace.js";
import type { SuiteReport, TrialEfficiency } from "../types.js";

/**
 * A regression past this fraction is worth saying out loud. Spec §9.2's 15%.
 *
 * Loose on purpose: model output length varies run to run, so a tight bound
 * would fire on healthy runs, and §7's argument about signals that fire on
 * healthy runs applies to warnings just as it does to gates.
 */
export const EFFICIENCY_WARN_DELTA = 0.15;

/**
 * The per-trial fold. Everything here is already in the trace — this is a fold
 * change, not an instrumentation change, and the harness's standing rule holds:
 * adding a scorer must never require adding instrumentation.
 *
 * `cacheWriteTokens` has no aggregate on `Trace`, only on each `ModelSpan`, so
 * it is summed here rather than read off.
 */
export function trialEfficiency(trace: Trace): TrialEfficiency {
  let cacheWriteTokens = 0;
  for (const span of trace.modelSpans) {
    cacheWriteTokens += span.cacheWriteTokens ?? 0;
  }
  return {
    modelMs: trace.model_ms,
    toolMs: trace.tool_ms,
    cacheReadTokens: trace.cacheReadTokens,
    cacheWriteTokens,
  };
}

/**
 * Run-level efficiency, normalised **per trial**.
 *
 * Per-trial rather than total is load-bearing. `--gate` implies `--trials 3`
 * (§9.2), so a totals comparison against a 1-trial baseline reports a 200%
 * regression the first time anyone runs the gate — a warning that fires on the
 * intended usage is worse than no warning at all.
 *
 * Quarantined cases are included: a quarantined case still costs real money and
 * real seconds, and this is the number that says what the run cost. That is the
 * opposite of `passed`/`total`, which count blocking cases only, because that
 * number answers a different question.
 */
export function suiteEfficiency(report: SuiteReport): SuiteEfficiency {
  const trials = report.cases.flatMap((c) => c.trials);
  if (trials.length === 0) {
    return { trials: 0, tokensPerTrial: 0, pricedTrials: 0 };
  }

  const tokens = trials.reduce((n, t) => n + t.inputTokens + t.outputTokens, 0);

  // Priced trials only. An unpriced trial is UNKNOWN, not free — averaging a
  // `undefined` in as zero would report an unpriced model as a cost saving,
  // which is the exact mistake `providers/pricing.ts` refuses to make.
  const priced = trials.filter((t) => t.costUsd !== undefined);
  const usd = priced.reduce((n, t) => n + (t.costUsd ?? 0), 0);

  // Trials recorded before `efficiency` existed carry none. Absent means
  // unknown: they are excluded from these means rather than folded in as zero,
  // so an old baseline degrades to "no comparison" instead of "infinite win".
  const timed = trials.filter(
    (t): t is typeof t & { efficiency: TrialEfficiency } =>
      t.efficiency !== undefined,
  );

  const out: SuiteEfficiency = {
    trials: trials.length,
    tokensPerTrial: tokens / trials.length,
    pricedTrials: priced.length,
    ...(priced.length > 0 ? { usdPerTrial: usd / priced.length } : {}),
  };

  if (timed.length > 0) {
    const modelMs = timed.reduce((n, t) => n + t.efficiency.modelMs, 0);
    const toolMs = timed.reduce((n, t) => n + t.efficiency.toolMs, 0);
    const cacheRead = timed.reduce(
      (n, t) => n + t.efficiency.cacheReadTokens,
      0,
    );
    const input = timed.reduce((n, t) => n + t.inputTokens, 0);
    out.modelMsPerTrial = modelMs / timed.length;
    out.toolMsPerTrial = toolMs / timed.length;
    // A cache read is a DISCOUNT off the inclusive `inputTokens`, not an
    // addend (see `providers/pricing.ts`), so this is a fraction of input and
    // cannot exceed 1. Summing the two would double-count the cheap tokens.
    if (input > 0) out.cacheReadRatio = cacheRead / input;
  }

  return out;
}

export interface SuiteEfficiency {
  /** Trials that contributed. 0 means nothing ran and nothing is comparable. */
  trials: number;
  tokensPerTrial: number;
  /** Over priced trials only; absent when none of them were priced. */
  usdPerTrial?: number;
  pricedTrials: number;
  /** Absent when no trial recorded timing — unknown, never zero. */
  modelMsPerTrial?: number;
  toolMsPerTrial?: number;
  /** Cache reads as a fraction of the inclusive input total. */
  cacheReadRatio?: number;
}

/**
 * Warnings, never verdicts. Empty when there is nothing to say.
 *
 * Only **tokens** is compared. Cost moves when a provider reprices and latency
 * moves with the network, so warning on either produces noise the harness did
 * not cause and cannot fix; `compare.ts` already draws this line the same way
 * ("tokens is the one under the harness's control"). The rest are reported by
 * `formatEfficiency` for a human to read.
 */
export function compareEfficiency(
  baseline: SuiteEfficiency,
  candidate: SuiteEfficiency,
): string[] {
  if (baseline.trials === 0 || candidate.trials === 0) return [];
  if (baseline.tokensPerTrial === 0) return [];

  const delta =
    (candidate.tokensPerTrial - baseline.tokensPerTrial) /
    baseline.tokensPerTrial;
  if (delta <= EFFICIENCY_WARN_DELTA) return [];

  return [
    `efficiency: ${Math.round(candidate.tokensPerTrial).toLocaleString()} tokens/trial, ` +
      `up ${(delta * 100).toFixed(0)}% from ${Math.round(baseline.tokensPerTrial).toLocaleString()} ` +
      `(warn only, over ${(EFFICIENCY_WARN_DELTA * 100).toFixed(0)}%)`,
  ];
}

/** One line for the terminal. Omits every figure the run did not measure. */
export function formatEfficiency(e: SuiteEfficiency): string {
  if (e.trials === 0) return "";
  const parts = [`${Math.round(e.tokensPerTrial).toLocaleString()} tokens`];
  if (e.modelMsPerTrial !== undefined) {
    parts.push(`${(e.modelMsPerTrial / 1000).toFixed(1)}s model`);
  }
  if (e.toolMsPerTrial !== undefined) {
    parts.push(`${(e.toolMsPerTrial / 1000).toFixed(1)}s tools`);
  }
  if (e.cacheReadRatio !== undefined) {
    parts.push(`${(e.cacheReadRatio * 100).toFixed(0)}% cached`);
  }
  return `per trial: ${parts.join(" · ")}`;
}
