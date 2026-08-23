// =============================================================================
// Argument matching — spec §4.1.
//
// Undefined matching semantics are a silent source of both false reds and
// false greens, so the three forms are fixed here and nowhere else.
// =============================================================================

import type { ArgMatcher } from "./types.js";

/**
 * Default is case-insensitive SUBSTRING of `String(actual)`.
 *
 * Substring is directional and the direction bites: expecting
 * `HANG_THRESHOLD_MS` FAILS when the model greps `HANG_THRESHOLD`, because the
 * expectation must be contained in the actual. Write the shortest needle that
 * still distinguishes right behaviour from wrong.
 */
export function matchArg(matcher: ArgMatcher, actual: unknown): boolean {
  if (typeof matcher === "string") {
    return stringify(actual).toLowerCase().includes(matcher.toLowerCase());
  }
  if ("$eq" in matcher) {
    return deepEqual(matcher.$eq, actual);
  }
  if ("$regex" in matcher) {
    return new RegExp(matcher.$regex, matcher.$flags ?? "i").test(
      stringify(actual),
    );
  }
  return false;
}

/**
 * Objects and arrays are compared as JSON rather than `String(...)`, which
 * would flatten every object to "[object Object]" and make any substring
 * match against a structured argument silently vacuous.
 */
function stringify(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "";
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null) return false;
  if (typeof a !== "object") return false;
  const aKeys = Object.keys(a as object);
  const bKeys = Object.keys(b as object);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((k) =>
    deepEqual(
      (a as Record<string, unknown>)[k],
      (b as Record<string, unknown>)[k],
    ),
  );
}

/** Human-readable form of a matcher, for the "why it failed" line. */
export function describeMatcher(matcher: ArgMatcher): string {
  if (typeof matcher === "string") return `'${matcher}'`;
  if ("$eq" in matcher) return `= ${JSON.stringify(matcher.$eq)}`;
  if ("$regex" in matcher) return `/${matcher.$regex}/`;
  return "?";
}
