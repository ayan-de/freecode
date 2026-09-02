// apps/core/src/providers/catalogue.ts
//
// Static table replacing what used to be six near-identical provider files.
// Values are transcribed from those files' own PROVIDER_INFO blocks and SDK
// construction calls, not from models.dev's raw catalogue — verified during
// planning that models.dev's own `zai`/`deepseek` entries use a different
// SDK/endpoint than freecode deliberately chose (see the design spec at
// docs/superpowers/specs/2026-09-02-dynamic-provider-catalogue-design.md).

export type EffortFamily = "anthropic" | "openai" | "gemini";

export interface ProviderCatalogueEntry {
  id: string;
  name: string;
  npm: "@ai-sdk/anthropic" | "@ai-sdk/openai" | "@ai-sdk/deepseek" | "@ai-sdk/google";
  /** Custom endpoint. Undefined uses the SDK's own default. */
  baseURL?: string;
  defaultModel: string;
  maxOutputTokens: number;
  /**
   * Which `applyEffort()` branch this provider uses, if any. Undefined means
   * effort is not routed for this provider — matches the six deleted files'
   * behavior: minimax/deepseek/zai never called `applyEffort` even though
   * minimax/zai share the anthropic SDK family with `anthropic` itself.
   */
  effortFamily?: EffortFamily;
}

export const PROVIDER_CATALOGUE: ProviderCatalogueEntry[] = [
  {
    id: "anthropic",
    name: "Anthropic",
    npm: "@ai-sdk/anthropic",
    defaultModel: "claude-sonnet-4-5",
    maxOutputTokens: 4096,
    effortFamily: "anthropic",
  },
  {
    id: "openai",
    name: "OpenAI",
    npm: "@ai-sdk/openai",
    defaultModel: "gpt-4o",
    maxOutputTokens: 4096,
    effortFamily: "openai",
  },
  {
    id: "gemini",
    name: "Google Gemini",
    npm: "@ai-sdk/google",
    // Verified against the live API 2026-08-29: `gemini-2.0-flash` returns "no
    // longer available" outright and `gemini-2.5-flash` "no longer available to
    // new users", both pointing here. A retired default is not a soft failure —
    // it breaks the provider for anyone who does not name a model.
    defaultModel: "gemini-3.6-flash",
    maxOutputTokens: 4096,
    effortFamily: "gemini",
  },
  {
    id: "minimax",
    name: "MiniMax",
    // MiniMax exposes an Anthropic Messages-compatible endpoint, so this
    // reuses @ai-sdk/anthropic with a custom baseURL instead of hand-rolling
    // a client (matches anthropic itself).
    npm: "@ai-sdk/anthropic",
    baseURL: "https://api.minimax.io/anthropic/v1",
    defaultModel: "MiniMax-M2",
    // The old 4096 default truncated large tool calls (e.g. a `write` with a
    // long body) mid-JSON, which the AI SDK then surfaced as an unparseable
    // tool call. The endpoint's own ceilings are far higher — 524288 for
    // MiniMax-M3, 196608 for MiniMax-M2 — so this only needs to be large
    // enough for a full file write in one call. It was 65536, but MiniMax
    // charges max_tokens against the same context window, so that reserved a
    // third of M2's 196608 and forced auto-compaction to fire at 60%
    // occupancy. 32000 (utils.ts's OUTPUT_TOKEN_CAP) keeps the write headroom
    // while giving the rest of the window back to the conversation.
    maxOutputTokens: 32_000,
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    npm: "@ai-sdk/deepseek",
    defaultModel: "deepseek-chat",
    maxOutputTokens: 4096,
  },
  {
    id: "zai",
    name: "Z.ai (GLM)",
    // z.ai (GLM) exposes an Anthropic Messages-compatible endpoint, so this
    // reuses @ai-sdk/anthropic with a custom baseURL instead of a new SDK
    // dependency (same approach as minimax).
    npm: "@ai-sdk/anthropic",
    baseURL: "https://api.z.ai/api/anthropic",
    defaultModel: "glm-5.2",
    maxOutputTokens: 4096,
  },
];
