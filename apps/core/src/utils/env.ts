// =============================================================================
// Numeric environment variables.
//
// `Number("")` is 0, not NaN, and `Number.isFinite(0)` is true — so the common
// shape
//
//   Number.isFinite(Number(process.env.X)) ? Math.max(0, Number(...)) : DEFAULT
//
// reads an EMPTY variable as a deliberate zero rather than as unset. That is a
// footgun in every direction that matters: `FREECODE_TOOL_RESULT_BUDGET_CHARS=""`
// pruned every tool result to a marker, and an empty eval timeout clamped a
// five-minute budget to one second. A variable exported empty by a wrapper
// script, or set to "" to "turn it off", silently reconfigured the agent.
//
// This parses the way `getCompactTarget()` in compaction/tokens.ts already
// does — integers only, and a value that cannot be read is WARNED about rather
// than silently swallowed, because a typo is otherwise indistinguishable from
// the feature being broken.
// =============================================================================

import { logger } from "./logger.js";

export interface EnvIntOptions {
  /** Smallest accepted value. A parse below it warns and falls back. */
  min?: number;
  /** Largest accepted value, for knobs where a huge value is a typo. */
  max?: number;
}

/**
 * Read an integer environment variable.
 *
 * Unset, empty, or whitespace-only all mean "not configured" and yield
 * `fallback` silently — an unset variable is the normal case and must not warn.
 * Anything else that does not parse to an integer inside [min, max] warns and
 * yields `fallback`.
 */
export function envInt(
  name: string,
  fallback: number,
  options: EnvIntOptions = {},
): number {
  const raw = process.env[name];
  // The bug this module exists for: "" and "   " are absence, not zero.
  if (raw === undefined || raw.trim() === "") return fallback;

  // Decimal only, matched explicitly rather than left to `Number`, which also
  // accepts "0x10" (16), "1e3" (1000) and " 12 ". None of those is a spelling
  // anyone means in an environment variable, and silently honouring one is the
  // same class of surprise as reading "" as 0.
  const text = raw.trim();
  const parsed = /^[+-]?\d+$/.test(text) ? Number(text) : Number.NaN;
  const { min = Number.NEGATIVE_INFINITY, max = Number.POSITIVE_INFINITY } =
    options;
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
    logger.warn(
      `[env] Ignoring ${name}="${raw}" — expected an integer. Using ${fallback}.`,
    );
    return fallback;
  }
  if (parsed < min || parsed > max) {
    logger.warn(
      `[env] Ignoring ${name}="${raw}" — expected an integer in ` +
        `[${min}, ${max}]. Using ${fallback}.`,
    );
    return fallback;
  }
  return parsed;
}
