# opencode's provider/SDK strategy — and what it means for us

Source: `/home/ayande/Project/githubprojects/opencode` (packages/opencode), read 2026-07-30.

## What we already do right

We already follow the core idea: use the Vercel AI SDK instead of hand-rolling
wire protocols. `anthropic.ts`, `openai.ts`, `gemini.ts` are thin wrappers
around `@ai-sdk/anthropic` / `@ai-sdk/openai` / `@ai-sdk/google` — same
approach opencode uses for its 18 first-party providers.

## What we don't do yet

**`minimax.ts` (450 lines) hand-rolls a full Anthropic Messages API client**
(raw `fetch`, SSE parsing, tool-schema conversion, `cache_control` injection,
thinking-block extraction) against MiniMax's Anthropic-compatible endpoint
(`https://api.minimax.io/anthropic/v1/messages`), instead of pointing
`@ai-sdk/anthropic`'s `createAnthropic({ baseURL })` at that same endpoint.
`baseURL` is a supported option (confirmed in
`@ai-sdk/anthropic@*/dist/index.d.ts:1147`). This is exactly the code opencode
avoids writing per-provider.

## opencode's actual pattern

1. **18 first-party `@ai-sdk/*` packages** for providers with dedicated AI SDK
   support (see table below) — same as us, just more of them.
2. **`@ai-sdk/openai-compatible` as the default fallback** for everything else.
   Confirmed in `provider/transform.ts:1641`: `npm: model.provider?.npm ??
   provider.npm ?? "@ai-sdk/openai-compatible"` — if a provider/model isn't
   explicitly mapped to a first-party package, it silently routes through the
   generic OpenAI-compatible adapter, pointed at that provider's base URL.
3. **Model/provider metadata comes from models.dev**, an external
   community-maintained catalog (`@opencode-ai/core/models-dev`), fetched and
   cached rather than hand-written per provider. Base URLs, context limits,
   pricing, and — critically — which `npm` package/protocol a given model
   should use, all live in that catalog data, not in opencode's own code.
4. **Provider-specific quirks are centralized in one file**, `provider/transform.ts`,
   keyed by string-matching on model ID (e.g. `id.includes("minimax-m2")`),
   not by a bespoke file per provider. Example — MiniMax specifically:
   - `temperature` clamped to `1.0` for `minimax-m2` (transform.ts:535)
   - `topP` defaults to `0.95` for `minimax-m2` (transform.ts:551)
   - `topK` set to 40/20 depending on `minimax-m2` sub-version (transform.ts:559-562)
   - MiniMax-M3 reasoning/thinking defaults handled specially when routed
     through **either** `@ai-sdk/anthropic` or `@ai-sdk/openai-compatible`
     (transform.ts:728-732) — confirming MiniMax is dual-routed: some
     model/provider combos go through the Anthropic-shaped adapter, others
     through the generic OpenAI-compatible one, chosen per catalog entry.

So the actual shape is: **generic transport (AI SDK's compatible adapters) +
externally-sourced routing/metadata (models.dev) + one centralized quirks
table**, not N hand-rolled provider clients.

## Provider → SDK package table (opencode, `packages/opencode/package.json`)

| Provider | Package |
|---|---|
| Alibaba (Qwen) | `@ai-sdk/alibaba` |
| Amazon Bedrock | `@ai-sdk/amazon-bedrock` |
| Anthropic | `@ai-sdk/anthropic` |
| Azure OpenAI | `@ai-sdk/azure` |
| Cerebras | `@ai-sdk/cerebras` |
| Cohere | `@ai-sdk/cohere` |
| DeepInfra | `@ai-sdk/deepinfra` |
| Vercel AI Gateway | `@ai-sdk/gateway` |
| Google Gemini | `@ai-sdk/google` |
| Google Vertex AI | `@ai-sdk/google-vertex` |
| Groq | `@ai-sdk/groq` |
| Mistral | `@ai-sdk/mistral` |
| OpenAI | `@ai-sdk/openai` |
| Perplexity | `@ai-sdk/perplexity` |
| Together AI | `@ai-sdk/togetherai` |
| Vercel | `@ai-sdk/vercel` |
| xAI (Grok) | `@ai-sdk/xai` |
| **Everything else** (MiniMax, Zhipu/zai, DeepSeek, Baseten, Fireworks, OpenRouter, GitHub Copilot, Cloudflare, local/self-hosted, …) | `@ai-sdk/openai-compatible` (generic, driven by models.dev's per-model `baseURL`/`npm` fields) — **or** `@ai-sdk/anthropic` with a custom `baseURL` when the provider's wire format is Anthropic-shaped (MiniMax's case) |

Note: `@ai-sdk/openai` and `@ai-sdk/openai-compatible` are different packages —
the former is the first-party OpenAI adapter, the latter is the generic
schema-compatible one used for any OpenAI-shaped API regardless of vendor.

## Recommendation for us

1. **Rewrite `minimax.ts` to reuse `@ai-sdk/anthropic`** with
   `createAnthropic({ apiKey, baseURL: "https://api.minimax.io/anthropic/v1" })`,
   mirroring `anthropic.ts`'s `execute`/`stream` implementation instead of
   duplicating it. Cuts ~400 lines of hand-rolled SSE/tool-schema code down to
   roughly what `anthropic.ts` is (~235 lines, most of it shared shape).
   Keep MiniMax-specific quirks (if any — check whether `cache_control`
   injection or thinking-block handling differs from stock Anthropic) as a
   small delta on top, not a full reimplementation.
2. **Only add `@ai-sdk/openai-compatible` as a dependency once we have a
   second provider that isn't Anthropic/OpenAI-shaped** (e.g. DeepSeek, Groq,
   a local server). At that point, route it generically instead of writing
   `providers/<name>.ts` per new provider — same as opencode's fallback.
3. **Don't adopt models.dev wholesale** — it's overkill for our 4 (soon
   effectively 3, post-minimax-rewrite) providers. Revisit only if the
   provider count grows past ~6-8 and hand-maintaining `config.ts` base
   URLs/context limits becomes real maintenance burden.
4. If/when quirks accumulate across providers (temperature clamps, reasoning
   effort mapping, etc.), centralize them the way opencode does — one
   `transform.ts`-shaped file keyed by model ID — rather than scattering
   `if (model.includes(...))` checks through each provider file.
