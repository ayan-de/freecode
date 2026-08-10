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
  OUTPUT_TOKEN_CAP,
  PROVIDER_MAX_RETRIES,
} from "./utils.js";
import { normalizeAiSdkStream } from "./streaming.js";

// MiniMax exposes an Anthropic Messages-compatible endpoint, so we reuse
// @ai-sdk/anthropic with a custom baseURL instead of hand-rolling a client
// (matches anthropic.ts; see docs/superpowers/plans/opencode-provider-sdk-strategy.md).
const BASE_URL = "https://api.minimax.io/anthropic/v1";

// The old 4096 default truncated large tool calls (e.g. a `write` with a long
// body) mid-JSON, which the AI SDK then surfaced as an unparseable tool call.
// The endpoint's own ceilings are far higher — 524288 for MiniMax-M3, 196608
// for MiniMax-M2 — so this only needs to be large enough for a full file write
// in one call. It was 65536, but MiniMax charges max_tokens against the same
// context window, so that reserved a third of M2's 196608 and forced
// auto-compaction to fire at 60% occupancy. OUTPUT_TOKEN_CAP keeps the write
// headroom while giving the rest of the window back to the conversation.
const MAX_OUTPUT_TOKENS = OUTPUT_TOKEN_CAP;

const PROVIDER_INFO = {
  id: "minimax" as const,
  name: "MiniMax",
  defaultModel: "MiniMax-M2",
  supportsStreaming: true,
  supportsTools: true,
  maxOutputTokens: MAX_OUTPUT_TOKENS,
};

function createMiniMaxProvider(_apiKey: string): AIProvider {
  const minimax = createAnthropic({
    apiKey: getApiKey("minimax"),
    baseURL: BASE_URL,
    fetch: createTimeoutFetch(),
  });

  // Build the same options shape for execute() and stream() (mirrors anthropic.ts).
  function buildOptions(opts: ExecuteOptions) {
    const model = resolveModel(
      opts.model,
      PROVIDER_INFO.id,
      PROVIDER_INFO.defaultModel,
    );

    const tools = buildToolsParam(opts.tools);

    const generateOptions: any = {
      model: minimax(model),
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

registerProvider("minimax", {
  info: PROVIDER_INFO,
  create: createMiniMaxProvider,
});
