// =============================================================================
// Autonomous Runs Budget — four-way ceiling check
// PRIMARY: whichever of maxTurns/maxTokens/timeoutMs/maxUsd is hit first stops
// the run. Direct port of prime-agent's autonomousLimitReason, plus maxUsd
// (§4.3 — FreeCode has no OAuth free tier, so cost needs its own ceiling).
// Spec: docs/superpowers/specs/2026-08-10-autonomous-runs-design.md, §3.1/§4.3
// =============================================================================

import type { RunLimits, RunStopReason, RunUsage } from "./types.js";

/**
 * countedTokens excludes cache-read tokens by design (§4.3, §3.1): counting
 * them would exhaust budget from repeated context in a long verifier loop,
 * not from new work.
 */
export function countedTokens(usage: {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens?: number;
}): number {
  return (
    usage.inputTokens + usage.outputTokens + (usage.cacheCreationInputTokens ?? 0)
  );
}

/** First ceiling hit wins; undefined means still within budget. */
export function checkBudget(
  usage: RunUsage,
  limits: RunLimits,
): RunStopReason | undefined {
  if (usage.turns >= limits.maxTurns) return "maxTurns";
  if (usage.countedTokens >= limits.maxTokens) return "maxTokens";
  if (usage.elapsedMs >= limits.timeoutMs) return "timeoutMs";
  if (usage.usd >= limits.maxUsd) return "maxUsd";
  return undefined;
}
