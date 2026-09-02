/**
 * Format a token count number into a human-readable string.
 * e.g., 12300 → "12.3k", 1500000 → "1.5M"
 */
export function formatTokenCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return n.toString();
}

/** A run's or a day's token totals, split for the cache breakdown. */
export interface UsageTotals {
  /** Billed input — cache writes already folded in. */
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  /** The subset of `inputTokens` that was cache writes. */
  cacheWriteTokens: number;
}

/**
 * Share of billed input served from the prompt cache, as a 0-100 integer.
 *
 * `inputTokens` is the inclusive prompt total (non-cached + cache read +
 * cache write). The rate is therefore `cacheRead / inputTokens`. Adding
 * reads into the denominator a second time understates a working cache
 * (5.8M read of 6.7M in looked like 46% instead of 87%).
 *
 * Returns undefined when there is nothing to divide.
 */
export function cacheHitRate(
  inputTokens: number,
  cacheReadTokens: number,
): number | undefined {
  if (inputTokens <= 0) return undefined;
  return Math.min(100, Math.round((cacheReadTokens / inputTokens) * 100));
}
