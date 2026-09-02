// apps/core/src/providers/sdk-factories.ts

export interface SdkFactoryOptions {
  apiKey: string;
  baseURL?: string;
  fetch?: typeof globalThis.fetch;
  /** `@ai-sdk/openai-compatible` requires a provider name; the rest ignore it. */
  name?: string;
}

export type SdkFactory = (opts: SdkFactoryOptions) => unknown;

/**
 * npm package name → the SDK's `createXxx` factory, loaded on first use.
 *
 * Dynamic rather than static because the map is now sized by models.dev's
 * catalogue (212 providers across 28 packages) rather than by six hand-written
 * files. Eagerly importing 13 SDK packages to construct one provider is real
 * startup cost paid by every session; `import()` makes each one load only when
 * a provider that uses it is actually built. `bun build --compile` still
 * bundles these statically, so the release binary stays self-contained.
 *
 * Not exhaustive by design. models.dev names 28 distinct packages; this covers
 * the ones that authenticate with a plain API key, which is ~198 of the 212
 * providers. The rest (Bedrock, Vertex, Azure, watsonx, SAP) need per-provider
 * credential loaders, not just a package — see `catalogue.ts`'s note on why
 * that is deferred rather than half-done.
 */
const LOADERS: Record<string, () => Promise<SdkFactory>> = {
  "@ai-sdk/anthropic": () =>
    import("@ai-sdk/anthropic").then((m) => m.createAnthropic as SdkFactory),
  "@ai-sdk/openai": () =>
    import("@ai-sdk/openai").then((m) => m.createOpenAI as SdkFactory),
  "@ai-sdk/openai-compatible": () =>
    import("@ai-sdk/openai-compatible").then(
      (m) => m.createOpenAICompatible as SdkFactory,
    ),
  "@ai-sdk/google": () =>
    import("@ai-sdk/google").then(
      (m) => m.createGoogleGenerativeAI as SdkFactory,
    ),
  "@ai-sdk/deepseek": () =>
    import("@ai-sdk/deepseek").then((m) => m.createDeepSeek as SdkFactory),
  "@ai-sdk/xai": () => import("@ai-sdk/xai").then((m) => m.createXai as SdkFactory),
  "@ai-sdk/mistral": () =>
    import("@ai-sdk/mistral").then((m) => m.createMistral as SdkFactory),
  "@ai-sdk/groq": () =>
    import("@ai-sdk/groq").then((m) => m.createGroq as SdkFactory),
  "@ai-sdk/cohere": () =>
    import("@ai-sdk/cohere").then((m) => m.createCohere as SdkFactory),
  "@ai-sdk/togetherai": () =>
    import("@ai-sdk/togetherai").then((m) => m.createTogetherAI as SdkFactory),
  "@ai-sdk/perplexity": () =>
    import("@ai-sdk/perplexity").then((m) => m.createPerplexity as SdkFactory),
  "@ai-sdk/cerebras": () =>
    import("@ai-sdk/cerebras").then((m) => m.createCerebras as SdkFactory),
  "@ai-sdk/deepinfra": () =>
    import("@ai-sdk/deepinfra").then((m) => m.createDeepInfra as SdkFactory),
  "@ai-sdk/vercel": () =>
    import("@ai-sdk/vercel").then((m) => m.createVercel as SdkFactory),
  "@ai-sdk/gateway": () =>
    import("@ai-sdk/gateway").then((m) => m.createGateway as SdkFactory),
  "@openrouter/ai-sdk-provider": () =>
    import("@openrouter/ai-sdk-provider").then(
      (m) => m.createOpenRouter as unknown as SdkFactory,
    ),
};

/** Can this SDK package be loaded at all? Drives which catalogue entries register. */
export function hasSdkFactory(npm: string): boolean {
  return npm in LOADERS;
}

export function supportedSdkFamilies(): string[] {
  return Object.keys(LOADERS);
}

// One in-flight promise per package, so N providers sharing an SDK (172 share
// @ai-sdk/openai-compatible) import it once rather than once each.
const loaded = new Map<string, Promise<SdkFactory>>();

export function loadSdkFactory(npm: string): Promise<SdkFactory> {
  const cached = loaded.get(npm);
  if (cached) return cached;
  const loader = LOADERS[npm];
  if (!loader) {
    return Promise.reject(
      new Error(
        `No bundled SDK for "${npm}". Supported: ${supportedSdkFamilies().join(", ")}`,
      ),
    );
  }
  // Not cached on rejection: a transient import failure should not poison the
  // entry for the rest of the process.
  const promise = loader().catch((err) => {
    loaded.delete(npm);
    throw err;
  });
  loaded.set(npm, promise);
  return promise;
}
