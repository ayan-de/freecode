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
 * Cache reads bill at roughly a tenth of fresh input, so this is the single
 * number that says whether a session is cheap or not: at 90% the conversation
 * is being re-sent almost free, at 10% nearly every turn is paying full price
 * for history it already sent.
 *
 * `inputTokens` already contains cache *writes* — the loop folds them in
 * because they are billed as input — so the denominator is reads + input and
 * nothing else. Adding writes again would count them twice and understate the
 * rate. Returns undefined when there is nothing to divide.
 */
export function cacheHitRate(
  inputTokens: number,
  cacheReadTokens: number,
): number | undefined {
  const billedInput = inputTokens + cacheReadTokens;
  if (billedInput <= 0) return undefined;
  return Math.round((cacheReadTokens / billedInput) * 100);
}
