import { createOpenAI } from "@ai-sdk/openai";
import { generateText, streamText } from "ai";
import {
  AIProvider,
  ExecuteOptions,
  ExecuteResult,
  ProviderChunk,
} from "./types.js";
import { getApiKey } from "./config.js";
import { registerProvider } from "./registry.js";
import { convertToCoreMessages } from "./utils.js";
import { normalizeAiSdkStream } from "./streaming.js";

const PROVIDER_INFO = {
  id: "openai" as const,
  name: "OpenAI",
  defaultModel: "gpt-4o",
  supportsStreaming: true,
  supportsTools: true,
};

function createOpenAIProvider(_apiKey: string): AIProvider {
  const openai = createOpenAI({ apiKey: getApiKey("openai") });

  async function execute(opts: ExecuteOptions): Promise<ExecuteResult> {
    const model = opts.model || PROVIDER_INFO.defaultModel;

    const tools = opts.tools?.reduce(
      (acc, t) => {
        acc[t.name] = {
          description: t.description,
          inputSchema: t.parameters as Record<string, unknown>,
        };
        return acc;
      },
      {} as Record<
        string,
        { description: string; inputSchema: Record<string, unknown> }
      >,
    );

    // Cast to any to satisfy AI SDK's ToolSet type which expects FlexibleSchema<never>
    // The underlying implementation accepts plain JSON schema objects
    const systemPrompt =
      typeof opts.system === "string"
        ? opts.system
        : opts.system?.map((b) => b.text).join("\n\n");

    const generateOptions: any = {
      model: openai(model),
      system: systemPrompt,
      temperature: opts.temperature,
      maxOutputTokens: opts.maxTokens || 4096,
      tools: tools as any,
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

    return {
      content: result.text || "",
      thinking: undefined, // OpenAI doesn't have extended thinking in same way
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

  function buildOptions(opts: ExecuteOptions) {
    const model = opts.model || PROVIDER_INFO.defaultModel;
    const tools = opts.tools?.reduce(
      (acc, t) => {
        acc[t.name] = {
          description: t.description,
          inputSchema: t.parameters as Record<string, unknown>,
        };
        return acc;
      },
      {} as Record<
        string,
        { description: string; inputSchema: Record<string, unknown> }
      >,
    );
    const systemPrompt =
      typeof opts.system === "string"
        ? opts.system
        : opts.system?.map((b) => b.text).join("\n\n");
    const generateOptions: any = {
      model: openai(model),
      system: systemPrompt,
      temperature: opts.temperature,
      maxOutputTokens: opts.maxTokens || 4096,
      tools: tools as any,
    };
    if (opts.messages) {
      generateOptions.messages = convertToCoreMessages(opts.messages);
    } else {
      generateOptions.prompt = opts.prompt;
    }
    return generateOptions;
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

registerProvider("openai", {
  info: PROVIDER_INFO,
  create: createOpenAIProvider,
});
