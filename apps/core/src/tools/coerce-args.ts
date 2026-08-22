// =============================================================================
// coerce-args - normalize model-sent tool arguments against the declared schema.
//
// Tool inputs are model-generated JSON, and several providers quote scalars:
// {"head_limit": "30"} instead of {"head_limit": 30} (MiniMax through the
// Anthropic-compat endpoint is the reliable offender). The per-tool validator
// then rejects with "must be a number", the model re-sends the identical call,
// and the turn burns context in a reject-loop.
//
// This belongs at the boundary rather than inside each execute(): the declared
// `type` on every schema property is already the single source of truth for what
// a field should hold, so one pass over it covers every tool at once — including
// MCP tools, whose schemas we don't own and can't patch.
//
// Deliberately narrow, following claude-code's semanticNumber/semanticBoolean:
// only an unambiguous numeric literal, or exactly "true"/"false", is converted.
// Number()/truthiness coercion is the wrong fix — it turns "" into 0 and "false"
// into true, hiding a genuinely malformed call instead of letting the validator
// surface it. Anything else passes through untouched and still gets rejected.
// =============================================================================

import type { JsonSchema, JsonSchemaProperty } from "./tool.types.js";

// A quoted number we are willing to unquote: optional sign, digits, optional
// single decimal part. Excludes "", " ", "1e3", "0x10", "12abc", "NaN".
const NUMERIC_LITERAL = /^-?\d+(\.\d+)?$/;

// Some providers serialize numeric tool args as strings ("260"). Accept a number
// or a numeric string; return undefined for anything else so callers fall back
// to their default. Used by the per-tool validators, which name the field in
// their error message and so can afford to be more permissive than the silent
// schema-driven pass below.
export function coerceNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

// A 1-based line number or count: whole, and at least 1. Accepts the numeric
// strings coerceNumber does, so a provider that stringifies args is not punished
// for it.
export function isPositiveInt(value: unknown): boolean {
  const n = coerceNumber(value);
  return n !== undefined && Number.isInteger(n) && n >= 1;
}

// Same story for booleans: "true"/"false" arrive as strings from the same
// providers, and `params.asImage === true` would silently read a PNG as text.
export function coerceBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const v = value.trim().toLowerCase();
    if (v === "true") return true;
    if (v === "false") return false;
  }
  return undefined;
}

function coerceScalar(value: unknown, type: string | undefined): unknown {
  if (typeof value !== "string") return value;
  if (type === "number" || type === "integer") {
    return NUMERIC_LITERAL.test(value.trim()) ? Number(value) : value;
  }
  // `?? value` and not `?? undefined`: coerceBoolean returns false for "false",
  // which must survive the nullish check.
  if (type === "boolean") return coerceBoolean(value) ?? value;
  return value;
}

function coerceValue(value: unknown, prop: JsonSchemaProperty): unknown {
  if (prop.type === "object" && prop.properties) {
    return coerceArgs(prop as JsonSchema, value);
  }
  // Tuple-style `items` (an array of schemas) is not used by any tool here and
  // positional coercion would be guesswork, so it is left alone.
  if (
    prop.type === "array" &&
    prop.items &&
    !Array.isArray(prop.items) &&
    Array.isArray(value)
  ) {
    const items = prop.items;
    let changed = false;
    const out = value.map((entry) => {
      const next = coerceValue(entry, items);
      if (next !== entry) changed = true;
      return next;
    });
    return changed ? out : value;
  }
  return coerceScalar(value, prop.type);
}

/**
 * Returns `args` with quoted numbers/booleans converted to the type the schema
 * declares. Properties absent from the schema, and values that are not
 * unambiguous literals, are passed through untouched — this normalizes input,
 * it does not validate it. Returns the original object when nothing changed, so
 * the common path allocates nothing.
 */
export function coerceArgs(
  schema: JsonSchema | JsonSchemaProperty | undefined,
  args: unknown,
): unknown {
  if (!schema?.properties) return args;
  if (!args || typeof args !== "object" || Array.isArray(args)) return args;

  const source = args as Record<string, unknown>;
  let out: Record<string, unknown> | undefined;

  for (const [key, value] of Object.entries(source)) {
    const prop = schema.properties[key];
    if (!prop) continue;
    const next = coerceValue(value, prop);
    if (next === value) continue;
    out ??= { ...source };
    out[key] = next;
  }

  return out ?? args;
}
