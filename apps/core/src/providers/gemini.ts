import { createGoogleGenerativeAI } from "@ai-sdk/google";
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
  id: "gemini" as const,
  name: "Google Gemini",
  defaultModel: "gemini-2.0-flash",
  supportsStreaming: true,
  supportsTools: true,
};

function createGeminiProvider(_apiKey: string): AIProvider {
  const gemini = createGoogleGenerativeAI({ apiKey: getApiKey("gemini") });

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
      model: gemini.languageModel(model),
      system: systemPrompt,
      temperature: opts.temperature,
      maxOutputTokens: opts.maxTokens || 4096,
      tools: tools as any,
      abortSignal: opts.abortSignal,
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
      thinking: undefined, // Gemini doesn't expose thinking blocks
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
      model: gemini.languageModel(model),
      system: systemPrompt,
      temperature: opts.temperature,
      maxOutputTokens: opts.maxTokens || 4096,
      tools: tools as any,
      abortSignal: opts.abortSignal,
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

registerProvider("gemini", {
  info: PROVIDER_INFO,
  create: createGeminiProvider,
});
