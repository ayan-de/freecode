// =============================================================================
// ProviderShared — token-usage normalization helpers.
//
// Maps the AI SDK's `LanguageModelUsage` shape (apps/core sees this as
// `result.usage` on `generateText` / `streamText`) into the additive
// `NormalizedUsage` shape that downstream consumers — the agent loop, the
// daily tracker, the cache hit rate, the rollout recorder — read from.
//
// The AI SDK already does most of the per-provider work. Each
// `@ai-sdk/*` adapter (anthropic, openai, google, …) normalizes its wire
// payload into `LanguageModelV3Usage` with `total` / `noCache` /
// `cacheRead` / `cacheWrite` for input and `total` / `text` /
// `reasoning` for output, then the high-level SDK exposes it as
// `LanguageModelUsage` with `inputTokens` (the inclusive total),
// `inputTokenDetails.{noCache,cacheRead,cacheWrite}Tokens`,
// `outputTokens`, `outputTokenDetails.{text,reasoning}Tokens`, and
// `totalTokens`. Our mapper just renames the fields and preserves
// `providerMetadata`.
//
// Mirrors opencode's `packages/llm/src/protocols/shared.ts` (the
// `sumTokens` / `subtractTokens` / `totalTokens` / `visibleOutputTokens`
// helpers come straight from there). We still need them for the few
// cases where the AI SDK leaves a field undefined and we want a sensible
// derived value — e.g. Anthropic doesn't break extended thinking out of
// `output_tokens`, so `outputTokenDetails.reasoningTokens` is `undefined`
// and `outputTokens` carries the combined total — and for the rare
// "caller hands us a hand-built raw usage" path used by tests.
//
// Invariant we maintain end-to-end:
//   nonCachedInputTokens + cacheReadInputTokens + cacheWriteInputTokens
//     === inputTokens
//   reasoningTokens <= outputTokens
// =============================================================================

/**
 * Coerce an optional number into a non-negative, finite number. Returns 0
 * for `undefined`, NaN, or negative inputs — the latter because some
 * provider SDKs have been observed to report negative `cached_tokens` in
 * degenerate cases (OpenAI Chat Completions with stale caches). Used for
 * aggregates only — prefer the `undefined`-preserving helpers when
 * publishing.
 */
export const safe = (value: number | undefined): number => {
  if (value === undefined) return 0;
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, value);
};

/**
 * Subtract `subtrahend` from `total`, clamping at 0 when the provider
 * reports a nonsensical breakdown (e.g. `cached_tokens > prompt_tokens`).
 *
 * Returns `undefined` (not `0`) when `total` is `undefined` — we don't
 * fabricate counts. Returns `total` unchanged when `subtrahend` is
 * `undefined`, so callers can chain without losing information.
 */
export const subtractTokens = (
  total: number | undefined,
  subtrahend: number | undefined,
): number | undefined => {
  if (total === undefined) return undefined;
  if (subtrahend === undefined) return total;
  return Math.max(0, total - subtrahend);
};

/**
 * Sum a list of optional token counts, returning `undefined` only when
 * every value is `undefined` (so we don't fabricate a `0`).
 */
export const sumTokens = (
  ...values: ReadonlyArray<number | undefined>
): number | undefined => {
  if (values.every((value) => value === undefined)) return undefined;
  return values.reduce((acc: number, value) => acc + (value ?? 0), 0);
};

/**
 * Decide `totalTokens`. Honors a provider-supplied total when present;
 * otherwise falls back to `inputTokens + outputTokens` only when at least
 * one is defined. Returns `undefined` (never `0`) when neither is known,
 * so downstream consumers can tell "we have no usage data" from "a real
 * zero".
 */
export const totalTokens = (
  inputTokens: number | undefined,
  outputTokens: number | undefined,
  total: number | undefined,
): number | undefined => {
  if (total !== undefined) return total;
  if (inputTokens === undefined && outputTokens === undefined) return undefined;
  return (inputTokens ?? 0) + (outputTokens ?? 0);
};

/**
 * Visible output tokens = `outputTokens` minus `reasoningTokens`,
 * clamped to zero. The one place subtraction happens in this contract;
 * the clamp means a provider reporting `reasoningTokens > outputTokens`
 * produces a harmless zero rather than a negative that crashes downstream
 * schemas.
 *
 * `reasoningTokens` is `undefined` for providers that don't break thinking
 * out of `outputTokens` (Anthropic — a documented API limitation).
 */
export const visibleOutputTokens = (
  outputTokens: number | undefined,
  reasoningTokens: number | undefined,
): number | undefined => {
  if (outputTokens === undefined) return undefined;
  if (reasoningTokens === undefined) return outputTokens;
  return Math.max(0, outputTokens - reasoningTokens);
};

// ===========================================================================
// Normalization entry point.
// ===========================================================================

/**
 * `NormalizedUsage` is the additive shape carried on
 * `ExecuteResult["usage"]` and `ProviderChunk["usage"]`. Every field is
 * independently meaningful — consumers never have to subtract, so a
 * clamped difference cannot silently store the wrong number.
 */
export interface NormalizedUsage {
  /** Inclusive prompt total (cache reads + writes folded in). */
  inputTokens?: number;
  /** Inclusive output total (reasoning folded in when the provider merges). */
  outputTokens?: number;
  /** Prompt tokens NOT served from cache — the "fresh" portion. */
  nonCachedInputTokens?: number;
  /** Prompt tokens served from cache (cheap). */
  cacheReadInputTokens?: number;
  /** Prompt tokens written to cache this turn (cache creation). */
  cacheWriteInputTokens?: number;
  /** Subset of `outputTokens` spent on hidden reasoning. */
  reasoningTokens?: number;
  /** Inclusive input + output, or provider-supplied total when present. */
  totalTokens?: number;
  /** Raw `{ openai: ... }` / `{ anthropic: ... }` envelope, preserved. */
  providerMetadata?: Record<string, unknown>;
}

/**
 * The AI SDK's high-level `LanguageModelUsage` shape. `result.usage` on
 * `generateText` / `streamText` conforms to this. We accept the loose
 * form (every field optional, plus a few deprecated aliases) so we can
 * pull fields off both the new and the v5 spellings without casting at
 * every call site.
 */
export interface AiSdkUsage {
  inputTokens?: number | undefined;
  outputTokens?: number | undefined;
  inputTokenDetails?: {
    noCacheTokens?: number | undefined;
    cacheReadTokens?: number | undefined;
    cacheWriteTokens?: number | undefined;
  };
  outputTokenDetails?: {
    textTokens?: number | undefined;
    reasoningTokens?: number | undefined;
  };
  totalTokens?: number | undefined;
  /** @deprecated Use outputTokenDetails.reasoningTokens instead. */
  reasoningTokens?: number | undefined;
  /** @deprecated Use inputTokenDetails.cacheReadTokens instead. */
  cachedInputTokens?: number | undefined;
}

/**
 * Map the AI SDK's `LanguageModelUsage` (or any `result.usage` value) into
 * the additive `NormalizedUsage` shape. Returns `undefined` when the input
 * is `undefined` so callers can guard with a single check.
 *
 * Field resolution rules:
 *   - `inputTokens` — the inclusive total from the SDK, if present.
 *   - `cacheReadInputTokens` — `inputTokenDetails.cacheReadTokens`,
 *     falling back to the deprecated `cachedInputTokens`.
 *   - `cacheWriteInputTokens` — `inputTokenDetails.cacheWriteTokens`.
 *   - `nonCachedInputTokens` — `inputTokenDetails.noCacheTokens`,
 *     otherwise derived as `input - cacheRead - cacheWrite` (clamped).
 *   - `outputTokens` — from the SDK, if present.
 *   - `reasoningTokens` — `outputTokenDetails.reasoningTokens`,
 *     falling back to the deprecated `reasoningTokens`.
 *   - `totalTokens` — SDK's own total if present, else `input + output`.
 *   - `providerMetadata` — passed through unchanged.
 */
export function mapUsage(
  usage: AiSdkUsage | undefined | null,
  providerMetadata?: Record<string, unknown>,
): NormalizedUsage | undefined {
  if (!usage) return undefined;

  // Cache reads: prefer the v6 spelling; the v5 `cachedInputTokens` is
  // kept as a fallback for providers still emitting it.
  const cacheRead =
    usage.inputTokenDetails?.cacheReadTokens ?? usage.cachedInputTokens;

  const cacheWrite = usage.inputTokenDetails?.cacheWriteTokens;

  // `nonCachedInputTokens` is the only field that's derivable two ways.
  // Prefer the SDK's own `noCacheTokens`; if absent, subtract.
  const nonCached =
    usage.inputTokenDetails?.noCacheTokens ??
    subtractTokens(
      usage.inputTokens,
      cacheRead !== undefined || cacheWrite !== undefined
        ? safe(cacheRead) + safe(cacheWrite)
        : undefined,
    );

  // Reasoning: prefer the v6 spelling; the v5 `reasoningTokens` is
  // kept as a fallback.
  const reasoning =
    usage.outputTokenDetails?.reasoningTokens ?? usage.reasoningTokens;

  const total = totalTokens(
    usage.inputTokens,
    usage.outputTokens,
    usage.totalTokens,
  );

  const result: NormalizedUsage = {};
  if (usage.inputTokens !== undefined) result.inputTokens = usage.inputTokens;
  if (usage.outputTokens !== undefined) result.outputTokens = usage.outputTokens;
  if (nonCached !== undefined) result.nonCachedInputTokens = nonCached;
  if (cacheRead !== undefined) result.cacheReadInputTokens = cacheRead;
  if (cacheWrite !== undefined) result.cacheWriteInputTokens = cacheWrite;
  if (reasoning !== undefined) result.reasoningTokens = reasoning;
  if (total !== undefined) result.totalTokens = total;
  if (providerMetadata) result.providerMetadata = providerMetadata;
  return result;
}