# Dynamic Provider Catalogue (models.dev-driven)

Status: design, not yet approved for implementation
Supersedes: nothing (new subsystem within `apps/core/src/providers/`)

## Problem

`apps/core/src/models-dev.ts` passes through provider ids exactly as
models.dev names them (`"google"`). `apps/core/src/providers/registry.ts`
registers providers under a second, independently invented id
(`"gemini"`, from `providers/gemini.ts`). Nothing reconciles the two
vocabularies. Picking a Google model from `/model` writes
`current.provider: "google"` into config; the loop looks up `"google"` in
the registry and throws `Provider "google" not registered`. Patched
2026-09-02 with a one-line id remap in `models-dev.ts`, but the underlying
cause is structural: freecode maintains two independent provider
directories (models.dev's, and six hand-written files) that happen to
mostly agree.

Confirmed against a live fetch of `https://models.dev/api.json`:
models.dev already publishes everything freecode currently hardcodes
per provider:

```
anthropic  { npm: "@ai-sdk/anthropic",         api: null,                                  env: ["ANTHROPIC_API_KEY"] }
openai     { npm: "@ai-sdk/openai",             api: null,                                  env: ["OPENAI_API_KEY"] }
google     { npm: "@ai-sdk/google",             api: null,                                  env: ["GOOGLE_API_KEY", "GOOGLE_GENERATIVE_AI_API_KEY", "GEMINI_API_KEY"] }
deepseek   { npm: "@ai-sdk/openai-compatible",  api: "https://api.deepseek.com",             env: ["DEEPSEEK_API_KEY"] }
minimax    { npm: "@ai-sdk/anthropic",          api: "https://api.minimax.io/anthropic/v1",  env: ["MINIMAX_API_KEY"] }
zai        { npm: "@ai-sdk/openai-compatible",  api: "https://api.z.ai/api/paas/v4",         env: ["ZHIPU_API_KEY"] }
```

`minimax`'s and `zai`'s baseURL/SDK choices — currently justified with
hand-written comments in `minimax.ts`/`zai.ts` ("reuse `@ai-sdk/anthropic`
with a custom baseURL instead of hand-rolling a client") — are not
freecode-specific engineering decisions. They are models.dev data. The
six provider files exist to re-encode a catalogue that already exists.

opencode (`/home/ayande/Project/githubprojects/opencode`,
`packages/opencode/src/provider/provider.ts`) is built this way: one
`BUNDLED_PROVIDERS` map from npm package name to a dynamic SDK-factory
import, and every provider entry (id, name, npm, baseURL, env, model
list, model limits) is read from models.dev at runtime. There is no
second static registry to fall out of sync.

## Goal

Replace freecode's six hand-written provider files
(`anthropic.ts`, `openai.ts`, `gemini.ts`, `minimax.ts`, `deepseek.ts`,
`zai.ts`) with one generic driver built from models.dev metadata, so a
provider's identity has exactly one source of truth and this class of
bug (two id vocabularies disagreeing) cannot recur. `gemini-web`
(browser-automation, not in models.dev) stays a manual registration,
matching how opencode treats providers outside its catalog.

## Non-goals

- Not touching `browser/` or the ChatGPT DOM adapter.
- Not changing the `AIProvider` / `ExecuteOptions` / `ExecuteResult` /
  `ProviderChunk` interfaces in `types.ts` — the driver must produce
  objects satisfying the existing interface so every caller (agent loop,
  compaction, memory, eval harness) is untouched.
- Not adding providers models.dev doesn't list and freecode doesn't
  already support.
- Not changing streaming/timeout/retry/cache-invalidation behavior —
  those live in `streaming.ts`, `fetch-timeout.ts`,
  `cache-invalidation.ts`, `provider-shared.ts` and are already
  provider-agnostic; the driver calls them exactly as the six files do
  today.

## Canonical id: the migration question

This is the one decision with real blast radius. Two options:

**A. Adopt models.dev's id as canonical** (`"google"` replaces
`"gemini"` everywhere). Matches opencode exactly. Breaks every existing
`~/.freecode/config.json` with `providers.gemini`/`current.provider:
"gemini"`, every `pricing.json` override keyed `gemini/*`, and any
rollout/eval history keyed on the old id — silently, since a stale key
just stops matching rather than erroring.

**B. Keep freecode's existing ids as canonical, remap models.dev's id
to them at the boundary.** `models-dev.ts` already does exactly this
today (the id-remap patch). Extend the remap table to cover any other
divergence (currently only `google`→`gemini` is known to diverge — the
other five match). No migration, no silent breakage of existing
installs' config/pricing files.

**Recommendation: B.** The reason to go dynamic is to stop hand-maintaining
provider *behavior* (SDK choice, baseURL, env var) — it is not a reason to
also rename freecode's own stable ids, which are load-bearing in
`pricing.ts` (`"gemini/gemini-3.6-flash"` keys), `config.json` on every
existing install, and anywhere rollout history recorded a provider id.
Keep one small `CANONICAL_ID: Record<string, string>` (models.dev id →
freecode id) next to the driver, reviewed whenever models.dev adds a
provider. This is not "two vocabularies" in the way the current bug is:
it's one arbitrary rename table with a single direction and a single
owner, versus today's two independently-maintained id spaces.

## Design

### New: `providers/catalogue.ts`

Fetches/caches the models.dev provider list (reuses `models-dev.ts`'s
existing fetch+disk-cache — no new HTTP client). For each catalogue
entry, resolves:

- `id`: `CANONICAL_ID[rawId] ?? rawId`
- `npm`: SDK package name (drives which `BUNDLED_PROVIDERS` factory to use)
- `baseURL`: from `api`, when present
- `envKeys`: from `env` (first one found wins, same precedence config.ts
  already implements: config file → env var)
- `defaultModel`: models.dev does not name a "default" — freecode's six
  files each hardcode one (with a comment on why, e.g. gemini.ts's note
  that `gemini-2.5-flash` is retired). This must stay a small
  **freecode-owned override table** (`{ [id]: defaultModel }`), not
  derived from the catalogue. Same rationale for `maxOutputTokens` (a
  request-shaping default, not a catalogue fact) and `auxiliaryCalls`/
  `requiresApiKey` (freecode-specific policy flags, e.g. `gemini-web`'s
  `requiresApiKey: false`).

Only three things stay freecode-owned data, all small and explicit —
everything else (SDK choice, baseURL, env var name, id) comes from
models.dev:

```ts
const DEFAULT_MODEL: Record<string, string> = {
  anthropic: "claude-sonnet-4-5",
  openai: "gpt-4o",
  gemini: "gemini-3.6-flash",
  minimax: "MiniMax-M2",
  deepseek: "deepseek-chat",
  zai: "glm-5.2",
};
const CANONICAL_ID: Record<string, string> = { google: "gemini" };
const PROVIDER_POLICY: Record<string, Partial<ProviderInfo>> = {
  // only entries that diverge from the ProviderInfo defaults
};
```

### New: `providers/sdk-factories.ts`

Opencode's `BUNDLED_PROVIDERS` pattern, trimmed to the npm packages
freecode's six files actually import today — no speculative coverage of
SDKs freecode has never used:

```ts
const SDK_FACTORIES: Record<string, () => Promise<(opts: any) => any>> = {
  "@ai-sdk/anthropic": () => import("@ai-sdk/anthropic").then(m => m.createAnthropic),
  "@ai-sdk/openai": () => import("@ai-sdk/openai").then(m => m.createOpenAI),
  "@ai-sdk/google": () => import("@ai-sdk/google").then(m => m.createGoogleGenerativeAI),
  "@ai-sdk/openai-compatible": () => import("@ai-sdk/openai-compatible").then(m => m.createOpenAICompatible),
};
```

Adding a new provider models.dev lists under an SDK freecode doesn't
carry yet means adding one line here plus a `pnpm add` — not a new
provider file.

### New: `providers/generic-provider.ts`

One `createGenericProvider(catalogueEntry): AIProvider`, replacing the
duplicated `execute`/`stream`/`buildOptions` in all six files. Behavior
branches on **npm package**, not on provider id — this is the key
generalization, since it's already how the six files implicitly agree
(minimax and zai, npm `@ai-sdk/anthropic`, both call
`buildAnthropicSystemParam`/`applyMessageCaching`; openai's
`promptCacheKey` routing is openai-specific; gemini's thinking-level
clamp is google-specific):

```ts
switch (entry.npm) {
  case "@ai-sdk/anthropic":
    // buildAnthropicSystemParam + applyMessageCaching, effort key "anthropic"
  case "@ai-sdk/openai":
  case "@ai-sdk/openai-compatible":
    // promptCacheKey routing (openai only — deepseek/zai/minimax don't set it
    // today; carry that distinction, not blanket it on by npm alone), effort key "openai"
  case "@ai-sdk/google":
    // effort key "gemini" with the xhigh/max→high clamp
}
```

This mirrors `effort.ts`'s existing switch — `applyEffort` already
branches on a 3-way provider-family key; it gets re-keyed from provider
id to npm package (still a closed switch, same shape, just fed by SDK
family instead of hand-copied per file).

Everything else in `execute`/`stream` (tool building, message
conversion, usage mapping, streaming normalization, retry count, abort
signal, timeout fetch) is already identical across all six files today
— no change, just called once instead of six times.

### `registry.ts`

Unchanged interface. `initProviders()` becomes: fetch the catalogue,
`registerProvider(entry.id, { info, create: () => createGenericProvider(entry) })`
for each entry, then `registerProvider("gemini-web", ...)` for the one
manual (non-catalogue) provider exactly as today.

### Deleted

`providers/anthropic.ts`, `openai.ts`, `gemini.ts`, `minimax.ts`,
`deepseek.ts`, `zai.ts` (~890 lines). `effort.ts` stays but its switch
is re-keyed. `local-catalogue.ts`, `config.ts`, `types.ts`,
`provider-shared.ts`, `streaming.ts`, `fetch-timeout.ts`,
`cache-invalidation.ts`, `utils.ts`, `pricing.ts` are unchanged.

### Startup ordering

`initProviders()` currently registers synchronously via side-effecting
imports (`index.ts`: "fire and forget — registration is synchronous via
side effect"). A models.dev fetch is not synchronous. This is the one
real behavioral change beyond file structure:

- Options: (a) `initProviders()` becomes properly async and every
  caller of `getProvider`/`listProviders` awaits readiness (there
  appear to be few call sites — verify during planning); (b) ship a
  small static fallback table (id/npm/baseURL/env only, no model
  lists) for the six known providers so `getProvider()` never blocks
  on network, and the live catalogue only enriches model lists/limits
  (this is closer to what `models-dev.ts` already does for model
  limits — network failure falls back to disk cache, disk cache
  failure — for a first run — has nothing).
- Recommend (b): keeps `getProvider()`'s current synchronous contract,
  reuses the disk-cache-first fetch pattern `models-dev.ts` already has,
  and degrades gracefully (offline dev machine, models.dev outage)
  instead of failing every session start.

## Testing

- Every existing provider test (`utils.test.ts`, `streaming.test.ts`,
  `provider-shared.test.ts`, `cache-awareness.test.ts`,
  `cache-miss.test.ts`, `multimodal.test.ts`, `openai-cache-key.test.ts`,
  `output-cap.test.ts`, `auxiliary-calls.test.ts`, `pricing.test.ts`)
  must keep passing unchanged — they test the shared utils, not the
  six files being deleted, so this is the main regression net.
- New: one test per npm-family branch in `generic-provider.ts`
  (anthropic-shaped, openai-shaped, google-shaped, openai-compatible)
  asserting the same request shape the six files produce today —
  written by diffing against what each deleted file currently sends,
  not from scratch.
- New: `catalogue.ts` test for the `CANONICAL_ID` remap and the offline
  fallback path.
- Manual: `/model` picker end to end for all six providers plus
  `gemini-web`, since this is exactly the flow the original bug broke.

## Open questions for the plan phase

1. `maxOutputTokens` is `4096` for every one of the six providers today
   (`minimax.ts` names its constant `MAX_OUTPUT_TOKENS` but it is also
   `4096`) — confirm during planning whether that's one shared constant
   or still worth a per-provider override slot for future divergence.
2. How many call sites depend on `initProviders()`/`getProvider()` being
   synchronous — decides whether option (a) or (b) above is feasible.
3. Whether `pricing.ts`'s `provider/model` keys need any entries added
   for models the catalogue now exposes that weren't reachable before
   (unlikely, since the model *list* was already sourced from
   models.dev — only provider *identity* was hardcoded).
