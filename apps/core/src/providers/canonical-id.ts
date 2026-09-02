// apps/core/src/providers/canonical-id.ts
//
// Split into its own module so both boundaries that see a models.dev id can
// share one table: `catalogue.ts` (resolving provider identity) and
// `models-dev.ts` (mapping the model list). Keeping a copy in each is how the
// original bug happened — two independently-maintained id vocabularies that
// happened to mostly agree, until `google`/`gemini` didn't.
//
// `catalogue.ts` cannot host it: `models-dev.ts` would then import
// `catalogue.ts`, which imports `models-dev.ts`.

/**
 * models.dev's provider id → freecode's.
 *
 * Deliberately one-directional, and deliberately not the other way around.
 * freecode's ids are load-bearing in `pricing.ts` keys, in `current.provider`
 * in every existing ~/.freecode/config.json, and anywhere rollout history
 * recorded a provider — adopting models.dev's id wholesale would break those
 * silently, since a stale key stops matching rather than erroring.
 */
export const CANONICAL_ID: Record<string, string> = { google: "gemini" };

export function canonicalProviderId(modelsDevId: string): string {
  return CANONICAL_ID[modelsDevId] ?? modelsDevId;
}
