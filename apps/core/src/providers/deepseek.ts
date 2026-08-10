import { createDeepSeek } from "@ai-sdk/deepseek";
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

const PROVIDER_INFO = {
  id: "deepseek" as const,
  name: "DeepSeek",
  defaultModel: "deepseek-chat",
  supportsStreaming: true,
  supportsTools: true,
  maxOutputTokens: 4096,
};

function createDeepSeekProvider(_apiKey: string): AIProvider {
  const deepseek = createDeepSeek({
    apiKey: getApiKey("deepseek"),
    fetch: createTimeoutFetch(),
  });

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
      model: deepseek(model),
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

    return {
      content: result.text || "",
      thinking: undefined, // generateText doesn't expose reasoning; stream() does via reasoning deltas
      toolCalls: toolCalls?.length ? toolCalls : undefined,
      usage: result.usage
        ? {
            inputTokens: result.usage.inputTokens ?? 0,
            outputTokens: result.usage.outputTokens ?? 0,
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

registerProvider("deepseek", {
  info: PROVIDER_INFO,
  create: createDeepSeekProvider,
});
