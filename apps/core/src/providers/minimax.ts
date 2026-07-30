import { createAnthropic } from "@ai-sdk/anthropic";
import { generateText, streamText } from "ai";
import {
  AIProvider,
  ExecuteOptions,
  ExecuteResult,
  ProviderChunk,
} from "./types.js";
import { getApiKey } from "./config.js";
import { registerProvider } from "./registry.js";
import { convertToCoreMessages, buildAnthropicSystemParam, buildToolsParam } from "./utils.js";
import { normalizeAiSdkStream } from "./streaming.js";

// MiniMax exposes an Anthropic Messages-compatible endpoint, so we reuse
// @ai-sdk/anthropic with a custom baseURL instead of hand-rolling a client
// (matches anthropic.ts; see docs/superpowers/plans/opencode-provider-sdk-strategy.md).
const BASE_URL = "https://api.minimax.io/anthropic/v1";

const PROVIDER_INFO = {
  id: "minimax" as const,
  name: "MiniMax",
  defaultModel: "MiniMax-M2",
  supportsStreaming: true,
  supportsTools: true,
};

function createMiniMaxProvider(_apiKey: string): AIProvider {
  const minimax = createAnthropic({
    apiKey: getApiKey("minimax"),
    baseURL: BASE_URL,
  });

  // Build the same options shape for execute() and stream() (mirrors anthropic.ts).
  function buildOptions(opts: ExecuteOptions) {
    const model = opts.model || PROVIDER_INFO.defaultModel;

    const tools = buildToolsParam(opts.tools);

    const generateOptions: any = {
      model: minimax(model),
      temperature: opts.temperature,
      maxOutputTokens: opts.maxTokens || 4096,
      tools: tools as any,
      abortSignal: opts.abortSignal,
    };

    if (opts.system) {
      generateOptions.system = buildAnthropicSystemParam(opts.system);
    }

    if (opts.messages) {
      const coreMessages = convertToCoreMessages(opts.messages);
      if (coreMessages.length > 0) {
        const lastMsg = coreMessages[coreMessages.length - 1];
        if (lastMsg) {
          if (typeof lastMsg.content === "string") {
            lastMsg.content = [
              {
                type: "text",
                text: lastMsg.content,
                providerOptions: {
                  anthropic: { cacheControl: { type: "ephemeral" } },
                },
              } as any,
            ];
          } else if (Array.isArray(lastMsg.content)) {
            const lastPart = lastMsg.content[lastMsg.content.length - 1];
            if (lastPart && typeof lastPart === "object") {
              (lastPart as any).providerOptions = {
                anthropic: { cacheControl: { type: "ephemeral" } },
              };
            }
          }
        }
      }
      generateOptions.messages = coreMessages;
    } else {
      generateOptions.prompt = opts.prompt;
    }

    return generateOptions;
  }

  async function execute(opts: ExecuteOptions): Promise<ExecuteResult> {
    const model = opts.model || PROVIDER_INFO.defaultModel;
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

  async function* stream(
    opts: ExecuteOptions,
  ): AsyncGenerator<ProviderChunk> {
    const result = streamText(buildOptions(opts));
    yield* normalizeAiSdkStream(
      result.fullStream as unknown as AsyncIterable<
        { type: string } & Record<string, unknown>
      >,
    );
  }

  return { info: PROVIDER_INFO, execute, stream };
}

registerProvider("minimax", {
  info: PROVIDER_INFO,
  create: createMiniMaxProvider,
});
