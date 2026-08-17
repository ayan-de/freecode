import { createOpenAI } from "@ai-sdk/openai";
import { generateText, streamText } from "ai";
import {
  AIProvider,
  ExecuteOptions,
  ExecuteResult,
  ProviderChunk,
} from "./types.js";
import { getApiKey } from "./config.js";
import { createTimeoutFetch } from "./fetch-timeout.js";
import { registerProvider } from "./registry.js";
import {
  convertToCoreMessages,
  buildToolsParam,
  resolveModel,
  PROVIDER_MAX_RETRIES,
} from "./utils.js";
import { normalizeAiSdkStream } from "./streaming.js";
import { mapUsage } from "./provider-shared.js";
import type { ExecuteUsage } from "./types.js";

const PROVIDER_INFO = {
  id: "openai" as const,
  name: "OpenAI",
  defaultModel: "gpt-4o",
  supportsStreaming: true,
  supportsTools: true,
  maxOutputTokens: 4096,
};

function createOpenAIProvider(_apiKey: string): AIProvider {
  const openai = createOpenAI({
    apiKey: getApiKey("openai"),
    fetch: createTimeoutFetch(),
  });

  async function execute(opts: ExecuteOptions): Promise<ExecuteResult> {
    // Shares buildOptions with stream() rather than assembling its own copy:
    // the two were already identical, and a per-request cache key that only
    // reaches one of the two paths is worse than none at all — half a session's
    // turns would route on the key and half on the prefix hash.
    const { generateOptions, model } = buildOptions(opts);
    const result = await generateText(generateOptions);

    const toolCalls = result.toolCalls?.map(
      (tc): { name: string; args: Record<string, unknown>; id: string } => {
        const input = (tc as unknown as { input: Record<string, unknown> })
          .input;
        return {
          name: tc.toolName,
          args: input,
          id: tc.toolCallId,
        };
      },
    );

    // OpenAI Chat reports `prompt_tokens` (inclusive of cached reads),
    // `completion_tokens`, and a `prompt_tokens_details.cached_tokens`
    // subset — the AI SDK adapter folds that into `result.usage` with the
    // same shape every other provider exposes. Responses also breaks
    // `reasoning_tokens` out of `completion_tokens` via `outputTokenDetails`.
    // `providerMetadata.openai` is preserved for fields we don't surface
    // (e.g. `prompt_cache_key`).
    const usage: ExecuteUsage | undefined = result.usage
      ? mapUsage(result.usage, result.providerMetadata) ?? undefined
      : undefined;

    return {
      content: result.text || "",
      thinking: undefined, // OpenAI doesn't have extended thinking in same way
      toolCalls: toolCalls?.length ? toolCalls : undefined,
      usage,
      stopReason:
        result.finishReason === "tool-calls"
          ? "tool_use"
          : result.finishReason === "length"
            ? "max_tokens"
            : "stop",
      provider: PROVIDER_INFO.id,
      model,
    };
  }

  function buildOptions(opts: ExecuteOptions) {
    const model = resolveModel(
      opts.model,
      PROVIDER_INFO.id,
      PROVIDER_INFO.defaultModel,
    );
    const tools = buildToolsParam(opts.tools);
    const systemPrompt =
      typeof opts.system === "string"
        ? opts.system
        : opts.system?.map((b) => b.text).join("\n\n");
    const generateOptions: any = {
      model: openai(model),
      system: systemPrompt,
      temperature: opts.temperature,
      maxOutputTokens: opts.maxTokens || PROVIDER_INFO.maxOutputTokens,
      tools: tools as any,
      abortSignal: opts.abortSignal,
      maxRetries: PROVIDER_MAX_RETRIES,
    };
    // OpenAI caches prompt prefixes automatically — there are no breakpoints to
    // mark, which is why applyMessageCaching (an Anthropic-shaped concept) is
    // not called here. What is tunable is *routing*: the cache is sharded per
    // machine, and without a key OpenAI routes on a hash of the prefix. A
    // stable per-session key keeps a conversation's turns landing where its own
    // prefix is already warm. Same lever opencode pulls (transform.ts:1163).
    if (opts.sessionId) {
      generateOptions.providerOptions = {
        openai: { promptCacheKey: opts.sessionId },
      };
    }
    if (opts.messages) {
      generateOptions.messages = convertToCoreMessages(opts.messages);
    } else {
      generateOptions.prompt = opts.prompt;
    }
    // Hands back the resolved model as well as the options: execute() needs it
    // for the result, and resolving it a second time there would emit
    // resolveModel's no-model-configured warning twice per request.
    return { generateOptions, model };
  }

  async function* stream(opts: ExecuteOptions): AsyncGenerator<ProviderChunk> {
    const result = streamText(buildOptions(opts).generateOptions);
    yield* normalizeAiSdkStream(
      result.fullStream as unknown as AsyncIterable<
        { type: string } & Record<string, unknown>
      >,
    );
  }

  return { info: PROVIDER_INFO, execute, stream };
}

registerProvider("openai", {
  info: PROVIDER_INFO,
  create: createOpenAIProvider,
});
