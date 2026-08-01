import { logger } from "../utils/logger.js";

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

/**
 * Test override for the auto-compaction threshold, in tokens.
 *
 * Compaction normally fires just below the model's context window — 151,608 on
 * MiniMax-M2, 955,000 on M3 — which cannot be reached by hand, so verifying the
 * trigger otherwise means editing constants and remembering to revert them.
 * Set FREECODE_AUTO_COMPACT_TOKENS to a small number and it fires within a few
 * turns instead. Mirrors claude-code's CLAUDE_AUTOCOMPACT_PCT_OVERRIDE.
 *
 * Unset — the normal case — changes nothing.
 */
export function getAutoCompactOverride(): number | undefined {
  const raw = process.env.FREECODE_AUTO_COMPACT_TOKENS;
  if (!raw) return undefined;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    // Warn rather than ignore silently: a typo here looks identical to
    // compaction being broken, which is the thing being tested.
    logger.warn(
      `[compaction] Ignoring FREECODE_AUTO_COMPACT_TOKENS="${raw}" — expected a positive integer.`,
    );
    return undefined;
  }
  return parsed;
}

export function shouldCompact(
  tokenCount: number,
  model: string,
  bufferTokens: number,
  contextLimit?: number,
): boolean {
  const override = getAutoCompactOverride();
  if (override !== undefined) return tokenCount >= override;
  // Prefer an explicit (models.dev) limit; fall back to the local table.
  const limit =
    contextLimit && contextLimit > 0 ? contextLimit : getContextLimit(model);
  return tokenCount >= Math.max(0, limit - bufferTokens);
}
