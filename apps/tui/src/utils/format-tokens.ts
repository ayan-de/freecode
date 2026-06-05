/**
 * Format a token count number into a human-readable string.
 * e.g., 12300 → "12.3k", 1500000 → "1.5M"
 */
export function formatTokenCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return n.toString();
}
