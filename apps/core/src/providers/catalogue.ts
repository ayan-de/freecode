// apps/core/src/providers/catalogue.ts
//
// Provider identity, resolved from models.dev rather than hand-maintained.
//
// Three layers, in increasing precedence:
//   1. CATALOGUE_SNAPSHOT — generated at build time by
//      scripts/gen-provider-catalogue.mjs. The offline floor: a first run with
//      no disk cache and no network still knows how to construct a provider.
//   2. models-dev.ts's disk cache — fresher than the snapshot whenever the
//      user has opened the model picker. Read without a TTL check: a stale
//      catalogue entry is strictly better than falling back to a shipped one.
//   3. OVERRIDES — the only freecode-owned data left, and every entry states
//      why it is not simply models.dev's answer.
//
// The network is deliberately not consulted here. `initProviders()` runs on
// the startup path, models-dev.ts already refreshes the cache whenever the
// picker is opened, and blocking session start on models.dev being reachable
// would trade a stale provider list for a dead one.

import { CATALOGUE_SNAPSHOT } from "./catalogue-snapshot.js";
import type { SnapshotEntry } from "./catalogue-types.js";
import { readCachedProviders } from "../models-dev.js";
import { hasSdkFactory } from "./sdk-factories.js";
import { OUTPUT_TOKEN_CAP } from "./utils.js";

export type EffortFamily = "anthropic" | "openai" | "gemini";

export interface ProviderCatalogueEntry {
  id: string;
  name: string;
  npm: string;
  /** Custom endpoint. Undefined uses the SDK's own default. */
  baseURL?: string;
  /** Env var names holding this provider's key, in precedence order. */
  envKeys: string[];
  /**
   * Model used when the user has named none. models.dev does not publish a
   * "default", so this is absent for everything but the providers freecode has
   * actually verified one for — `resolveModel` reports the gap rather than
   * guessing a model id that may not exist.
   */
  defaultModel?: string;
  maxOutputTokens: number;
  /**
   * Which `applyEffort()` branch this provider uses, if any. Undefined means
   * effort is not routed — the default, since a provider that does not
   * understand a reasoning-effort parameter rejects the request outright.
   */
  effortFamily?: EffortFamily;
}

/**
 * models.dev's provider id → freecode's.
 *
 * Deliberately not the other way around. freecode's ids are load-bearing in
 * `pricing.ts` keys, in `current.provider` in every existing
 * ~/.freecode/config.json, and in recorded rollout history; adopting
 * models.dev's id wholesale would break those silently, since a stale key
 * stops matching rather than erroring.
 */
const CANONICAL_ID: Record<string, string> = { google: "gemini" };

/**
 * freecode-owned data. Everything absent from this table — name, SDK package,
 * baseURL, env var names — comes from models.dev.
 *
 * Two kinds of entry live here, and they are not the same thing:
 *   - Request-shaping defaults (`defaultModel`, `maxOutputTokens`,
 *     `effortFamily`) which models.dev does not publish at all.
 *   - Deliberate divergences from models.dev's own npm/baseURL, each carrying
 *     the reason it is not simply wrong to disagree.
 */
const OVERRIDES: Record<string, Partial<ProviderCatalogueEntry>> = {
  anthropic: {
    defaultModel: "claude-sonnet-4-5",
    effortFamily: "anthropic",
  },
  openai: {
    defaultModel: "gpt-4o",
    effortFamily: "openai",
  },
  gemini: {
    // Verified against the live API 2026-08-29: `gemini-2.0-flash` returns "no
    // longer available" outright and `gemini-2.5-flash` "no longer available to
    // new users", both pointing here. A retired default is not a soft failure —
    // it breaks the provider for anyone who does not name a model.
    defaultModel: "gemini-3.6-flash",
    effortFamily: "gemini",
  },
  minimax: {
    defaultModel: "MiniMax-M2",
    // The old 4096 default truncated large tool calls (e.g. a `write` with a
    // long body) mid-JSON, which the AI SDK then surfaced as an unparseable
    // tool call. The endpoint's own ceilings are far higher — 524288 for
    // MiniMax-M3, 196608 for MiniMax-M2 — so this only needs to be large
    // enough for a full file write in one call. It was 65536, but MiniMax
    // charges max_tokens against the same context window, so that reserved a
    // third of M2's 196608 and forced auto-compaction to fire at 60%
    // occupancy. OUTPUT_TOKEN_CAP keeps the write headroom while giving the
    // rest of the window back to the conversation.
    maxOutputTokens: OUTPUT_TOKEN_CAP,
  },
  deepseek: {
    // models.dev routes deepseek through @ai-sdk/openai-compatible. freecode
    // carries the dedicated @ai-sdk/deepseek package, which additionally maps
    // `prompt_cache_hit_tokens` into the usage breakdown that pricing.ts bills
    // from — the generic openai-compatible adapter reports it as a plain input
    // token, so switching would silently overbill cached reads.
    npm: "@ai-sdk/deepseek",
    baseURL: undefined,
    defaultModel: "deepseek-chat",
  },
  zai: {
    // models.dev lists zai as openai-compatible against .../paas/v4. z.ai also
    // exposes an Anthropic Messages-compatible endpoint, and freecode uses it
    // deliberately: that path accepts the cache breakpoints `applyMessageCaching`
    // sets, which the openai-compatible path has no way to express.
    npm: "@ai-sdk/anthropic",
    baseURL: "https://api.z.ai/api/anthropic",
    defaultModel: "glm-5.2",
  },
};

/**
 * Providers freecode lists even with no credential on file, so a new install
 * has something to pick from. Everything else in the catalogue still resolves
 * and runs — it just does not advertise itself before it can be used.
 *
 * This is a discovery list, not a support list: it says which names are worth
 * showing to someone who has configured nothing, and nothing more.
 */
export const FEATURED_PROVIDER_IDS = [
  "anthropic",
  "openai",
  "gemini",
  "minimax",
  "deepseek",
  "zai",
];

const DEFAULT_MAX_OUTPUT_TOKENS = 4096;

function toEntry(snapshot: SnapshotEntry): ProviderCatalogueEntry {
  const id = CANONICAL_ID[snapshot.id] ?? snapshot.id;
  const override = OVERRIDES[id] ?? {};
  return {
    id,
    name: snapshot.name,
    npm: snapshot.npm,
    baseURL: snapshot.baseURL,
    envKeys: snapshot.envKeys,
    maxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS,
    ...override,
  };
}

/**
 * The resolved catalogue, newest-source-wins, filtered to entries freecode can
 * actually construct.
 *
 * Entries whose SDK package has no bundled factory are dropped rather than
 * registered-and-broken: a provider that appears in the picker and throws
 * "No bundled SDK" on first use is worse than one that never appeared.
 */
export function resolveCatalogue(): ProviderCatalogueEntry[] {
  if (!memo) memo = computeCatalogue();
  return memo;
}

// Memoized for the life of the process. Resolution walks 212 snapshot entries
// plus the disk cache, and `hasApiKey` reaches it once per provider — with
// `providers.list` asking about every provider, resolving on each call turned
// opening the model picker into a 3.4s stall.
let memo: ProviderCatalogueEntry[] | undefined;
let envKeyIndex: Map<string, string[]> | undefined;

/** Drops the memo so the next read picks up a refreshed models.dev cache. */
export function invalidateCatalogue(): void {
  memo = undefined;
  envKeyIndex = undefined;
}

function computeCatalogue(): ProviderCatalogueEntry[] {
  // Keyed by canonical id, not raw: the snapshot carries models.dev's
  // "google" while the disk cache is written post-remap as "gemini", and
  // keying on the raw id would resolve both into two entries for one provider.
  const canonical = (id: string) => CANONICAL_ID[id] ?? id;
  const byId = new Map<string, SnapshotEntry>();
  for (const entry of CATALOGUE_SNAPSHOT) byId.set(canonical(entry.id), entry);

  for (const cached of readCachedProviders() ?? []) {
    // A cache written before the catalogue carried SDK metadata has no npm;
    // the snapshot's entry is the better answer until it refreshes.
    if (!cached.npm) continue;
    byId.set(canonical(cached.id), {
      id: cached.id,
      name: cached.name,
      npm: cached.npm,
      baseURL: cached.api,
      envKeys: cached.env ?? [],
    });
  }

  const resolved: ProviderCatalogueEntry[] = [];
  for (const snapshot of byId.values()) {
    const entry = toEntry(snapshot);
    if (!hasSdkFactory(entry.npm)) continue;
    resolved.push(entry);
  }
  return resolved;
}

/**
 * Env var names for a provider id, for callers outside the registry.
 *
 * Indexed rather than scanned: `hasApiKey` calls this per provider, and
 * `providers.list` calls `hasApiKey` for all ~198 of them.
 */
export function envKeysFor(id: string): string[] {
  if (!envKeyIndex) {
    envKeyIndex = new Map(resolveCatalogue().map((e) => [e.id, e.envKeys]));
  }
  return envKeyIndex.get(id) ?? [];
}
