// apps/core/src/providers/generic-provider.ts
import { generateText, streamText } from "ai";
import {
  AIProvider,
  ExecuteOptions,
  ExecuteResult,
  ExecuteUsage,
  ProviderChunk,
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
import { SDK_FACTORIES } from "./sdk-factories.js";
import type { ProviderCatalogueEntry } from "./catalogue.js";

/**
 * Assembles the AI SDK request options for one call, branching on the
 * catalogue entry's SDK family exactly where the six now-deleted provider
 * files implicitly agreed or diverged:
 *
 * - anthropic-family (`anthropic`, `minimax`, `zai` — all `@ai-sdk/anthropic`,
 *   `minimax`/`zai` against a custom baseURL): system via
 *   `buildAnthropicSystemParam`, messages get cache breakpoints via
 *   `applyMessageCaching`.
 * - `@ai-sdk/openai`: system flattened to a plain string; a `sessionId`
 *   caller hint sets the OpenAI cache-routing key under `providerOptions.openai`
 *   (openai only — this was never set for deepseek/minimax/zai).
 * - `@ai-sdk/deepseek` / `@ai-sdk/google`: system flattened to a plain
 *   string; no cache-key routing.
 *
 * `effortFamily` gates `applyEffort` exactly as the six files did — set only
 * for the `anthropic`/`openai`/`gemini` catalogue entries, never for
 * `minimax`/`deepseek`/`zai` even though `minimax`/`zai` share the anthropic
 * SDK family.
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

  if (entry.npm === "@ai-sdk/anthropic") {
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

export function createGenericProvider(entry: ProviderCatalogueEntry): AIProvider {
  const factory = SDK_FACTORIES[entry.npm];
  const sdk: any = factory({
    apiKey: getApiKey(entry.id),
    baseURL: entry.baseURL,
    fetch: createTimeoutFetch(),
  });

  // @ai-sdk/google's provider object is called via `.languageModel(id)`
  // rather than as a callable — matches the deleted gemini.ts's existing
  // `gemini.languageModel(model)` (not `gemini(model)`).
  function modelHandle(model: string): unknown {
    return entry.npm === "@ai-sdk/google" ? sdk.languageModel(model) : sdk(model);
  }

  const info = {
    id: entry.id,
    name: entry.name,
    defaultModel: entry.defaultModel,
    supportsStreaming: true,
    supportsTools: true,
    maxOutputTokens: entry.maxOutputTokens,
  };

  async function execute(opts: ExecuteOptions): Promise<ExecuteResult> {
    const model = resolveModel(
      opts.model,
      entry.id,
      entry.defaultModel,
      !opts.quietModelFallback,
    );
    const generateOptions = buildGenerateOptions(entry, modelHandle(model), opts);
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
    const generateOptions = buildGenerateOptions(entry, modelHandle(model), opts);
    const result = streamText({ ...generateOptions, onError: silenceStreamErrors });
    yield* normalizeAiSdkStream(
      result.fullStream as unknown as AsyncIterable<{ type: string } & Record<string, unknown>>,
    );
  }

  return { info, execute, stream };
}
