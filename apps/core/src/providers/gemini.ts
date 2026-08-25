import { createGoogleGenerativeAI } from "@ai-sdk/google";
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
  silenceStreamErrors,
} from "./utils.js";
import { normalizeAiSdkStream } from "./streaming.js";
import { mapUsage } from "./provider-shared.js";
import type { ExecuteUsage } from "./types.js";

const PROVIDER_INFO = {
  id: "gemini" as const,
  name: "Google Gemini",
  defaultModel: "gemini-2.0-flash",
  supportsStreaming: true,
  supportsTools: true,
  maxOutputTokens: 4096,
};

function createGeminiProvider(_apiKey: string): AIProvider {
  const gemini = createGoogleGenerativeAI({
    apiKey: getApiKey("gemini"),
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
    const systemPrompt =
      typeof opts.system === "string"
        ? opts.system
        : opts.system?.map((b) => b.text).join("\n\n");

    const generateOptions: any = {
      model: gemini.languageModel(model),
      system: systemPrompt,
      temperature: opts.temperature,
      maxOutputTokens: opts.maxTokens || PROVIDER_INFO.maxOutputTokens,
      tools: tools as any,
      abortSignal: opts.abortSignal,
      maxRetries: PROVIDER_MAX_RETRIES,
    };

    if (opts.messages) {
      generateOptions.messages = convertToCoreMessages(opts.messages);
    } else {
      generateOptions.prompt = opts.prompt;
    }

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

    // Gemini's wire payload is `promptTokenCount` (inclusive of
    // `cachedContentTokenCount`) + `candidatesTokenCount` (visible-only)
    // + `thoughtsTokenCount` (subset of output spent on thinking). The AI
    // SDK adapter folds that into `result.usage` with `outputTokens`
    // carrying `candidates + thoughts` and `outputTokenDetails.reasoningTokens`
    // carrying the thoughts subset — exactly the additive shape we publish.
    const usage: ExecuteUsage | undefined = result.usage
      ? mapUsage(result.usage, result.providerMetadata) ?? undefined
      : undefined;

    return {
      content: result.text || "",
      thinking: undefined, // Gemini doesn't expose thinking blocks
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
      !opts.quietModelFallback,
    );
    const tools = buildToolsParam(opts.tools);
    const systemPrompt =
      typeof opts.system === "string"
        ? opts.system
        : opts.system?.map((b) => b.text).join("\n\n");
    const generateOptions: any = {
      model: gemini.languageModel(model),
      system: systemPrompt,
      temperature: opts.temperature,
      maxOutputTokens: opts.maxTokens || PROVIDER_INFO.maxOutputTokens,
      tools: tools as any,
      abortSignal: opts.abortSignal,
      maxRetries: PROVIDER_MAX_RETRIES,
    };
    if (opts.messages) {
      generateOptions.messages = convertToCoreMessages(opts.messages);
    } else {
      generateOptions.prompt = opts.prompt;
    }
    return generateOptions;
  }

  async function* stream(opts: ExecuteOptions): AsyncGenerator<ProviderChunk> {
    const result = streamText({
      ...buildOptions(opts),
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

registerProvider("gemini", {
  info: PROVIDER_INFO,
  create: createGeminiProvider,
});
