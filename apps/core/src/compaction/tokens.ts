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
 * Cost ceiling for the conversation, independent of the model's window.
 *
 * Compaction used to fire only when the next request would not *fit*. That is a
 * hard constraint, not the objective: on a 1M-window model (MiniMax-M3) it puts
 * the trigger near 968K, so a session that peaks at 270K never compacts and every
 * one of its requests carries the full history. One recorded 7-message session
 * cost 48.1M input tokens that way (spec 2026-08-05-token-efficiency, RC1).
 *
 * This caps that: whatever the window allows, stop growing the conversation past
 * the point where a full-context request is affordable. 120K is the knee — below
 * it a request is cheap at cache-read rates, above it the per-turn cost dominates.
 *
 * It binds on any model whose usable window exceeds it, which is the intent:
 * a 200K model compacts at the same point a 1M one does, because the cost of a
 * 120K request is the same either way.
 */
export const DEFAULT_COMPACT_TARGET_TOKENS = 120_000;

/**
 * The active cost ceiling, overridable via FREECODE_COMPACT_TARGET_TOKENS.
 *
 * Read per call rather than at module load — matching getAutoCompactOverride()
 * below — so tests and a long-lived daemon both see a change without a restart.
 * Set it high (e.g. 500000) to get the old fit-only behaviour back on a large
 * window; set it low to compact aggressively on a small quota.
 */
export function getCompactTarget(): number {
  const raw = process.env.FREECODE_COMPACT_TARGET_TOKENS;
  if (!raw) return DEFAULT_COMPACT_TARGET_TOKENS;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    // Same reasoning as the auto-compact override: a typo here is
    // indistinguishable from compaction being broken, so say so.
    logger.warn(
      `[compaction] Ignoring FREECODE_COMPACT_TARGET_TOKENS="${raw}" — expected a positive integer.`,
    );
    return DEFAULT_COMPACT_TARGET_TOKENS;
  }
  return parsed;
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
  const windowLimit =
    contextLimit && contextLimit > 0 ? contextLimit : getContextLimit(model);
  // Whichever binds first: what the model can hold, or what we're willing to
  // pay for on every subsequent turn.
  const limit = Math.min(windowLimit, getCompactTarget());
  return tokenCount >= Math.max(0, limit - bufferTokens);
}
