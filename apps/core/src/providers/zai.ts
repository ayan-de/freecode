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
} from "./utils.js";
import { normalizeAiSdkStream } from "./streaming.js";

// z.ai (GLM) exposes an Anthropic Messages-compatible endpoint, so we reuse
// @ai-sdk/anthropic with a custom baseURL instead of a new SDK dependency
// (same approach as minimax.ts; see docs/superpowers/plans/opencode-provider-sdk-strategy.md).
const BASE_URL = "https://api.z.ai/api/anthropic";

const PROVIDER_INFO = {
  id: "zai" as const,
  name: "Z.ai (GLM)",
  defaultModel: "glm-5.2",
  supportsStreaming: true,
  supportsTools: true,
  maxOutputTokens: 4096,
};

function createZaiProvider(_apiKey: string): AIProvider {
  const zai = createAnthropic({
    apiKey: getApiKey("zai"),
    baseURL: BASE_URL,
    fetch: createTimeoutFetch(),
  });

  function buildOptions(opts: ExecuteOptions) {
    const model = resolveModel(
      opts.model,
      PROVIDER_INFO.id,
      PROVIDER_INFO.defaultModel,
    );

    const tools = buildToolsParam(opts.tools);

    const generateOptions: any = {
      model: zai(model),
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

  async function execute(opts: ExecuteOptions): Promise<ExecuteResult> {
    const model = resolveModel(
      opts.model,
      PROVIDER_INFO.id,
      PROVIDER_INFO.defaultModel,
    );
    const result = await generateText(buildOptions(opts));

    const toolCalls = result.toolCalls?.map(
      (tc): { name: string; args: Record<string, unknown>; id: string } => {
        const input = (tc as unknown as { input: Record<string, unknown> })
          .input;
        return { name: tc.toolName, args: input, id: tc.toolCallId };
      },
    );

    const anthropicMetadata = result.providerMetadata?.anthropic as any;

    return {
      content: result.text || "",
      thinking: undefined, // AI SDK generateText doesn't expose thinking blocks; stream() does via reasoning deltas
      toolCalls: toolCalls?.length ? toolCalls : undefined,
      usage: result.usage
        ? {
            inputTokens: result.usage.inputTokens ?? 0,
            outputTokens: result.usage.outputTokens ?? 0,
            cacheCreationInputTokens:
              anthropicMetadata?.cacheCreationInputTokens ?? undefined,
            cacheReadInputTokens:
              anthropicMetadata?.cacheReadInputTokens ?? undefined,
          }
        : undefined,
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

  async function* stream(opts: ExecuteOptions): AsyncGenerator<ProviderChunk> {
    const result = streamText(buildOptions(opts));
    yield* normalizeAiSdkStream(
      result.fullStream as unknown as AsyncIterable<
        { type: string } & Record<string, unknown>
      >,
    );
  }

  return { info: PROVIDER_INFO, execute, stream };
}

registerProvider("zai", {
  info: PROVIDER_INFO,
  create: createZaiProvider,
});
