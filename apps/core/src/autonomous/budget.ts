// =============================================================================
// Run budget — four independent ceilings, first one hit stops the run.
// PURE: no IO, no clock of its own (`now` is passed in), no agent loop.
// Spec: docs/superpowers/specs/2026-08-10-autonomous-runs-design.md §4.3,
// a direct port of Prime Agent's `autonomousLimitReason` plus `maxUsd`.
// =============================================================================

import type { RunLimits, RunStopReason, RunUsage } from "./types.js";

/**
 * Tokens that count against `maxTokens`: input + output + cache **writes**.
 *
 * Cache reads are excluded, and this is the load-bearing line of the whole
 * budget. Counting them cumulatively would make a long verifier loop exhaust
 * the budget from re-sent *context* rather than new work — every turn resends
 * the conversation, so a healthy cached run would look like a runaway one. A
 * cache write is billed and is new, so it counts; a cache read is billed at a
 * discount for something already paid for, and does not.
 */
export function billedTokens(usage: RunUsage): number {
  return usage.inputTokens + usage.outputTokens + usage.cacheWriteTokens;
}

export interface BudgetCheckInput {
  limits: RunLimits;
  usage: RunUsage;
  turns: number;
  /** Wall clock since `startedAt`, so a sleeping laptop still spends time. */
  elapsedMs: number;
}

/**
 * The first ceiling breached, or `undefined` while the run may continue.
 *
 * Order is fixed and tested: turns, tokens, time, usd. It matters only for the
 * reported reason when two ceilings break on the same check — but a run that
 * reports the wrong reason sends its reader to the wrong knob, so it is worth
 * pinning rather than leaving to object key order.
 */
export function budgetExceeded(
  input: BudgetCheckInput,
): RunStopReason | undefined {
  const { limits, usage, turns, elapsedMs } = input;

  if (turns >= limits.maxTurns) return "budget_turns";
  if (billedTokens(usage) >= limits.maxTokens) return "budget_tokens";
  if (elapsedMs >= limits.timeoutMs) return "budget_time";
  if (
    limits.maxUsd !== undefined &&
    usage.usd !== undefined &&
    usage.usd >= limits.maxUsd
  ) {
    return "budget_usd";
  }
  return undefined;
}

/** Fraction of each ceiling consumed, for a checkpoint line or a report. */
export function budgetUsage(input: BudgetCheckInput): Record<string, number> {
  const { limits, usage, turns, elapsedMs } = input;
  const ratio = (used: number, cap: number) => (cap <= 0 ? 1 : used / cap);
  return {
    turns: ratio(turns, limits.maxTurns),
    tokens: ratio(billedTokens(usage), limits.maxTokens),
    time: ratio(elapsedMs, limits.timeoutMs),
    ...(limits.maxUsd !== undefined
      ? { usd: ratio(usage.usd ?? 0, limits.maxUsd) }
      : {}),
  };
}

/** Fold one turn's provider usage into the running total. */
export function addUsage(total: RunUsage, delta: Partial<RunUsage>): RunUsage {
  return {
    inputTokens: total.inputTokens + (delta.inputTokens ?? 0),
    outputTokens: total.outputTokens + (delta.outputTokens ?? 0),
    cacheWriteTokens: total.cacheWriteTokens + (delta.cacheWriteTokens ?? 0),
    cacheReadTokens: total.cacheReadTokens + (delta.cacheReadTokens ?? 0),
    ...(total.usd !== undefined || delta.usd !== undefined
      ? { usd: (total.usd ?? 0) + (delta.usd ?? 0) }
      : {}),
  };
}
