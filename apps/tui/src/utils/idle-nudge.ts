// =============================================================================
// Idle-return nudge (spec 2026-08-09-cache-observability, D1)
//
// After a long gap the prompt cache has expired, so the next message re-sends
// the entire conversation as fresh input at full price. If the user is starting
// an unrelated task that spend is pure waste — and only they know whether it is.
// So: tell them what it costs, and let them decide.
// =============================================================================

import { formatTokenCount } from "./format-tokens.js";

/**
 * Context size below which the nudge never fires, however long the gap.
 * Re-sending 20K after a coffee break is not worth interrupting anyone for.
 * `FREECODE_IDLE_NUDGE_TOKENS=0` disables the nudge entirely.
 */
export const DEFAULT_IDLE_NUDGE_TOKENS = 100_000;

export function getIdleNudgeThreshold(): number {
  const raw = process.env.FREECODE_IDLE_NUDGE_TOKENS;
  if (raw === undefined) return DEFAULT_IDLE_NUDGE_TOKENS;
  const parsed = Number.parseInt(raw, 10);
  // Unparseable is treated as "leave the default alone" rather than as 0:
  // silently disabling a cost warning because of a typo is the worse failure.
  if (!Number.isFinite(parsed) || parsed < 0) return DEFAULT_IDLE_NUDGE_TOKENS;
  return parsed;
}

/**
 * Prompt-cache TTL in ms, from the same `FREECODE_CACHE_TTL` core reads.
 *
 * Mirrors the table in `apps/core/src/providers/utils.ts` — core is spawned as
 * a child of this process, so both see the same value. Kept here rather than
 * fetched over IPC because the nudge has to decide *before* the request is
 * sent, and a round trip for a two-entry constant is not worth the latency.
 * If core gains a TTL value, add it here too or the nudge will warn early.
 */
export function getCacheTtlMs(): number {
  return process.env.FREECODE_CACHE_TTL?.trim() === "1h"
    ? 60 * 60 * 1000
    : 5 * 60 * 1000;
}

export interface IdleNudgeInput {
  /** Context occupancy of the conversation about to be re-sent. */
  contextTokens: number;
  /** Milliseconds since the last completed turn; undefined on a fresh session. */
  idleMs?: number;
  /** The cache TTL this session is actually configured for, in ms. */
  ttlMs: number;
  /** Whether a nudge has already been shown since the last send. */
  alreadyShown: boolean;
}

/**
 * The nudge text, or undefined when it should stay quiet.
 *
 * Idle is measured against the *configured* TTL rather than a fixed number of
 * minutes (claude-code hardcodes 75). Under FREECODE_CACHE_TTL=1h a 40-minute
 * gap costs nothing, and a nudge claiming otherwise would contradict the
 * cold-cache warning that shares the same clock.
 */
export function idleNudgeMessage(input: IdleNudgeInput): string | undefined {
  const threshold = getIdleNudgeThreshold();
  if (threshold === 0) return undefined;
  if (input.alreadyShown) return undefined;
  // No completed turn yet — there is no stale context to warn about.
  if (input.idleMs === undefined) return undefined;
  if (input.contextTokens < threshold) return undefined;
  if (input.idleMs <= input.ttlMs) return undefined;

  const mins = Math.round(input.idleMs / 60_000);
  return (
    `~${formatTokenCount(input.contextTokens)} tokens will be re-sent as fresh ` +
    `input — the prompt cache expired ${mins} min ago. ` +
    `**/clear** to start a new task, or ignore this to carry on.`
  );
}
