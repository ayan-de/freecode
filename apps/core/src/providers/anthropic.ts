import { createAnthropic } from "@ai-sdk/anthropic";
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
  buildAnthropicSystemParam,
  buildToolsParam,
  applyMessageCaching,
  resolveModel,
  PROVIDER_MAX_RETRIES,
  silenceStreamErrors,
} from "./utils.js";
import { normalizeAiSdkStream } from "./streaming.js";
import { mapUsage } from "./provider-shared.js";
import type { ExecuteUsage } from "./types.js";

const PROVIDER_INFO = {
  id: "anthropic" as const,
  name: "Anthropic",
  defaultModel: "claude-sonnet-4-5",
  supportsStreaming: true,
  supportsTools: true,
  maxOutputTokens: 4096,
};

function createAnthropicProvider(_apiKey: string): AIProvider {
  const anthropic = createAnthropic({
    apiKey: getApiKey("anthropic"),
    fetch: createTimeoutFetch(),
  });

  async function execute(opts: ExecuteOptions): Promise<ExecuteResult> {
    const model = resolveModel(
      opts.model,
      PROVIDER_INFO.id,
      PROVIDER_INFO.defaultModel,
      !opts.quietModelFallback,
    );

    const tools = buildToolsParam(opts.tools);

    // Cast to any to satisfy AI SDK's ToolSet type which expects FlexibleSchema<never>
    // The underlying implementation accepts plain JSON schema objects
    const generateOptions: any = {
      model: anthropic(model),
      temperature: opts.temperature,
      maxOutputTokens: opts.maxTokens || PROVIDER_INFO.maxOutputTokens,
      tools: tools as any,
      abortSignal: opts.abortSignal,
      maxRetries: PROVIDER_MAX_RETRIES,
    };

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

    const result = await generateText(generateOptions);

    const toolCalls = result.toolCalls?.map(
      (tc): { name: string; args: Record<string, unknown>; id: string } => {
        // tc is TypedToolCall<ToolSet> - input is the args, toolCallId is the id
        const input = (tc as unknown as { input: Record<string, unknown> })
          .input;
        return {
          name: tc.toolName,
          args: input,
          id: tc.toolCallId,
        };
      },
    );

    const content = result.text || "";
    // Preserve the raw Anthropic wire payload (`cache_creation_input_tokens`,
    // `cache_read_input_tokens`, server-side ids, …) on `providerMetadata`
    // for billing audit and for any future field we don't yet normalize.
    // The AI SDK normalizes Anthropic's `input_tokens` (non-cached only) into
    // `result.usage.inputTokens` (the *inclusive* total = input + cache_*
    // + cache_read) plus the breakdown on `inputTokenDetails`, so the mapper
    // produces the full additive shape with no extra derivation here.
    const usage: ExecuteUsage | undefined = result.usage
      ? mapUsage(result.usage, result.providerMetadata) ?? undefined
      : undefined;

    return {
      content,
      thinking: undefined, // V3 SDK doesn't expose thinking blocks
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

  // Build the same options shape as execute() so both paths share the setup.
  function buildOptions(opts: ExecuteOptions) {
    const model = resolveModel(
      opts.model,
      PROVIDER_INFO.id,
      PROVIDER_INFO.defaultModel,
      !opts.quietModelFallback,
    );

    const tools = buildToolsParam(opts.tools);

    const generateOptions: any = {
      model: anthropic(model),
      temperature: opts.temperature,
      maxOutputTokens: opts.maxTokens || PROVIDER_INFO.maxOutputTokens,
      tools: tools as any,
      abortSignal: opts.abortSignal,
      maxRetries: PROVIDER_MAX_RETRIES,
    };

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

    return generateOptions;
  }

  async function* stream(opts: ExecuteOptions): AsyncGenerator<ProviderChunk> {
    const streamOptions = buildOptions(opts);
    const result = streamText({
      ...streamOptions,
      onError: silenceStreamErrors,
    });
    yield* normalizeAiSdkStream(
      result.fullStream as unknown as AsyncIterable<
        { type: string } & Record<string, unknown>
      >,
    );
  }

  return { info: PROVIDER_INFO, execute, stream };
}

// Register on module load
registerProvider("anthropic", {
  info: PROVIDER_INFO,
  create: createAnthropicProvider,
});
