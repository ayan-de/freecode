// apps/core/src/providers/generic-provider.ts
import { generateText, streamText } from "ai";
import {
  AIProvider,
  ExecuteOptions,
  ExecuteResult,
  ExecuteUsage,
  ProviderChunk,
  ProviderInfo,
} from "./types.js";
import { getApiKey } from "./config.js";
import { createTimeoutFetch } from "./fetch-timeout.js";
import {
  convertToCoreMessages,
  buildAnthropicSystemParam,
  buildToolsParam,
  applyMessageCaching,
  resolveModel,
  PROVIDER_MAX_RETRIES,
  silenceStreamErrors,
} from "./utils.js";
import { normalizeAiSdkStream } from "./streaming.js";
import { mapUsage } from "./provider-shared.js";
import { applyEffort } from "./effort.js";
import { loadSdkFactory } from "./sdk-factories.js";
import type { ProviderCatalogueEntry } from "./catalogue.js";

/**
 * Which branch of request-shaping an SDK package needs.
 *
 * Keyed by npm package rather than provider id: `anthropic`, `minimax` and
 * `zai` all speak the Anthropic Messages shape because they all go through
 * `@ai-sdk/anthropic`, and 172 of models.dev's providers share
 * `@ai-sdk/openai-compatible`. Anything not named here is openai-shaped, which
 * is what every remaining bundled SDK expects.
 */
function requestShape(npm: string): "anthropic" | "openai" {
  return npm === "@ai-sdk/anthropic" ? "anthropic" : "openai";
}

/**
 * Assembles the AI SDK request options for one call, branching on the SDK
 * package rather than the provider id:
 *
 * - `@ai-sdk/anthropic` (`anthropic`, `minimax`, `zai`, and the other
 *   Anthropic-compatible endpoints models.dev lists): system via
 *   `buildAnthropicSystemParam`, messages get cache breakpoints via
 *   `applyMessageCaching`.
 * - everything else: system flattened to a plain string. `promptCacheKey` is
 *   set for `@ai-sdk/openai` alone — it is OpenAI's own cache-routing
 *   parameter, and openai-compatible endpoints reject unknown fields.
 *
 * `effortFamily` gates `applyEffort`, and is set only for the three providers
 * whose reasoning-effort parameter has been verified. It is deliberately not
 * inferred from the SDK package: `minimax` and `zai` speak
 * `@ai-sdk/anthropic` without accepting Anthropic's `effort`, so keying
 * effort off the package would send a field those endpoints reject.
 */
export function buildGenerateOptions(
  entry: ProviderCatalogueEntry,
  modelHandle: unknown,
  opts: ExecuteOptions,
): any {
  const tools = buildToolsParam(opts.tools);
  const generateOptions: any = {
    model: modelHandle,
    temperature: opts.temperature,
    maxOutputTokens: opts.maxTokens || entry.maxOutputTokens,
    tools: tools as any,
    abortSignal: opts.abortSignal,
    maxRetries: PROVIDER_MAX_RETRIES,
  };

  if (requestShape(entry.npm) === "anthropic") {
    if (opts.system) {
      generateOptions.system = buildAnthropicSystemParam(opts.system);
    }
    if (opts.messages) {
      const coreMessages = convertToCoreMessages(opts.messages);
      applyMessageCaching(coreMessages);
      generateOptions.messages = coreMessages;
    } else {
      generateOptions.prompt = opts.prompt;
    }
  } else {
    const systemPrompt =
      typeof opts.system === "string"
        ? opts.system
        : opts.system?.map((b) => b.text).join("\n\n");
    generateOptions.system = systemPrompt;
    if (opts.messages) {
      generateOptions.messages = convertToCoreMessages(opts.messages);
    } else {
      generateOptions.prompt = opts.prompt;
    }
    if (entry.npm === "@ai-sdk/openai" && opts.sessionId) {
      generateOptions.providerOptions = {
        openai: { promptCacheKey: opts.sessionId },
      };
    }
  }

  if (entry.effortFamily) {
    applyEffort(generateOptions, entry.effortFamily, opts.effort);
  }

  return generateOptions;
}

/**
 * The `ProviderInfo` for a catalogue entry.
 *
 * One function rather than a literal in both `registry.ts` and here: the
 * registry's copy is what `allowsAuxiliaryCalls` and `providerRequiresApiKey`
 * read, while callers holding an `AIProvider` read the other. Two literals
 * meant a policy flag added to one and not the other would diverge silently.
 */
export function providerInfoFor(entry: ProviderCatalogueEntry): ProviderInfo {
  return {
    id: entry.id,
    name: entry.name,
    defaultModel: entry.defaultModel,
    supportsStreaming: true,
    supportsTools: true,
    maxOutputTokens: entry.maxOutputTokens,
  };
}

export function createGenericProvider(entry: ProviderCatalogueEntry): AIProvider {
  // Built on first request, not at registration. Three reasons, all of which
  // bite now that the catalogue is ~198 providers rather than six:
  //   - the SDK package is `import()`ed, so construction is async while
  //     `getProvider()` is synchronous at nine call sites;
  //   - `getApiKey` throws when no key is configured, and registering a
  //     provider must not require having its credential;
  //   - nothing should pay to load an SDK for a provider it never calls.
  let sdkPromise: Promise<any> | undefined;
  function getSdk(): Promise<any> {
    if (!sdkPromise) {
      sdkPromise = loadSdkFactory(entry.npm)
        .then((factory) =>
          factory({
            apiKey: getApiKey(entry.id, entry.envKeys),
            baseURL: entry.baseURL,
            fetch: createTimeoutFetch(),
            // Only @ai-sdk/openai-compatible requires this; the rest ignore it.
            name: entry.id,
          }),
        )
        .catch((err) => {
          // Not memoized on failure: a missing key set after the first attempt
          // should work on the next one, without restarting the process.
          sdkPromise = undefined;
          throw err;
        });
    }
    return sdkPromise;
  }

  // @ai-sdk/google's provider object is called via `.languageModel(id)` rather
  // than as a callable; every other bundled SDK is callable directly.
  async function modelHandle(model: string): Promise<unknown> {
    const sdk = await getSdk();
    return entry.npm === "@ai-sdk/google" ? sdk.languageModel(model) : sdk(model);
  }

  const info = providerInfoFor(entry);

  async function execute(opts: ExecuteOptions): Promise<ExecuteResult> {
    const model = resolveModel(
      opts.model,
      entry.id,
      entry.defaultModel,
      !opts.quietModelFallback,
    );
    const generateOptions = buildGenerateOptions(
      entry,
      await modelHandle(model),
      opts,
    );
    const result = await generateText(generateOptions);

    const toolCalls = result.toolCalls?.map(
      (tc): { name: string; args: Record<string, unknown>; id: string } => {
        const input = (tc as unknown as { input: Record<string, unknown> }).input;
        return { name: tc.toolName, args: input, id: tc.toolCallId };
      },
    );

    const usage: ExecuteUsage | undefined = result.usage
      ? mapUsage(result.usage, result.providerMetadata) ?? undefined
      : undefined;

    return {
      content: result.text || "",
      thinking: undefined,
      toolCalls: toolCalls?.length ? toolCalls : undefined,
      usage,
      stopReason:
        result.finishReason === "tool-calls"
          ? "tool_use"
          : result.finishReason === "length"
            ? "max_tokens"
            : "stop",
      provider: entry.id,
      model,
      echoedModel: result.response?.modelId,
    };
  }

  async function* stream(opts: ExecuteOptions): AsyncGenerator<ProviderChunk> {
    const model = resolveModel(
      opts.model,
      entry.id,
      entry.defaultModel,
      !opts.quietModelFallback,
    );
    const generateOptions = buildGenerateOptions(
      entry,
      await modelHandle(model),
      opts,
    );
    const result = streamText({ ...generateOptions, onError: silenceStreamErrors });
    yield* normalizeAiSdkStream(
      result.fullStream as unknown as AsyncIterable<{ type: string } & Record<string, unknown>>,
    );
  }

  return { info, execute, stream };
}
