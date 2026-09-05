// =============================================================================
// JSON-RPC -32602 (invalid params) validation.
//
// Every handler reads its params through `params as { … }`. A cast checks
// nothing, so a missing or misspelled field arrived as `undefined` and blew
// up somewhere inside the handler — reported as -32603 (internal error),
// which tells the caller the server is broken when in fact the request was.
//
// The contract lives in `REQUIRED_PARAMS` next to `METHODS` in
// packages/shared, typed so a new method cannot skip it. This module is only
// the check.
//
// Deliberately narrow: presence and JSON type of the REQUIRED params, nothing
// more. It is not a schema validator. Optional params keep being the
// handler's business (they have defaults), and unknown params are ignored so
// a newer frontend talking to an older core still works.
// =============================================================================

import {
  REQUIRED_PARAMS,
  type MethodName,
  type ParamType,
} from "@thisisayande/freecode-shared";

/** JSON-RPC reserved code for "invalid method parameters". */
export const INVALID_PARAMS = -32602;

function jsonTypeOf(value: unknown): ParamType | "null" | "undefined" {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (Array.isArray(value)) return "array";
  const t = typeof value;
  if (t === "string" || t === "number" || t === "boolean") return t;
  if (t === "object") return "object";
  // function/symbol/bigint cannot survive JSON transport; report the raw tag.
  return t as ParamType;
}

/**
 * Returns a human-readable reason the params are invalid, or undefined when
 * they are acceptable. The message names the field and both types, because
 * the whole point is that the caller can fix the call from the error alone.
 */
export function validateParams(
  method: string,
  params: Record<string, unknown>,
): string | undefined {
  const required = REQUIRED_PARAMS[method as MethodName];
  // An undeclared method is -32601's problem, not ours. Reaching here at all
  // means the method exists but predates the table, and refusing the call
  // would be worse than letting the handler run.
  if (!required) return undefined;

  for (const [name, expected] of Object.entries(required)) {
    const actual = jsonTypeOf(params[name]);
    if (actual === "undefined" || actual === "null") {
      return `Missing required parameter "${name}" (expected ${expected})`;
    }
    if (actual !== expected) {
      return `Parameter "${name}" must be ${expected}, got ${actual}`;
    }
  }
  return undefined;
}
