const CHARS_PER_TOKEN = 4;

// Conservative offline floor. The live source of truth is models.dev, resolved
// via getModelContextLimit() and passed into shouldCompact() as an explicit
// limit; this constant is used only when that lookup returns nothing (no
// network, cold cache, or unknown model). A per-model table here would just
// drift out of date — being wrong only makes us compact slightly early, never
// lose data, so a single safe value is enough.
export const FALLBACK_CONTEXT_LIMIT = 100_000;

export function estimateTokenCount(text: string): number {
  if (text.length === 0) return 0;
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

// Kept for callers/tests; always returns the offline floor now that the live
// limit comes from models.dev via shouldCompact's contextLimit argument.
export function getContextLimit(_model: string): number {
  return FALLBACK_CONTEXT_LIMIT;
}

export function getAutoCompactThreshold(
  model: string,
  bufferTokens: number,
): number {
  return Math.max(0, getContextLimit(model) - bufferTokens);
}

export function shouldCompact(
  tokenCount: number,
  model: string,
  bufferTokens: number,
  contextLimit?: number,
): boolean {
  // Prefer an explicit (models.dev) limit; fall back to the local table.
  const limit =
    contextLimit && contextLimit > 0 ? contextLimit : getContextLimit(model);
  return tokenCount >= Math.max(0, limit - bufferTokens);
}
