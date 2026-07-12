import {
  AIProvider,
  ExecuteOptions,
  ExecuteResult,
  ProviderChunk,
} from "./types.js";
import { getApiKey } from "./config.js";
import { registerProvider } from "./registry.js";

const PROVIDER_INFO = {
  id: "minimax" as const,
  name: "MiniMax",
  defaultModel: "MiniMax-M2",
  supportsStreaming: true,
  supportsTools: true,
};

const BASE_URL = "https://api.minimax.io/anthropic/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";

// =============================================================================
// buildRequestBody
// Constructs the Anthropic-compatible Messages API body from ExecuteOptions.
// Shared by both execute() (one-shot) and stream() (SSE) paths.
// =============================================================================
function buildRequestBody(opts: ExecuteOptions): {
  body: Record<string, unknown>;
  model: string;
} {
  const model = opts.model || PROVIDER_INFO.defaultModel;

  const messages: Array<{
    role: "user" | "assistant";
    content: string | Array<{ type: string; [key: string]: unknown }>;
  }> = [];
  if (opts.system) {
    const systemPrompt =
      typeof opts.system === "string"
        ? opts.system
        : opts.system.map((b) => b.text).join("\n\n");
    messages.push({ role: "user", content: systemPrompt });
  }

  if (opts.messages) {
    for (const msg of opts.messages) {
      const textParts: string[] = [];
      const toolCalls: Array<{
        type: string;
        id: string;
        name: string;
        input: Record<string, unknown>;
      }> = [];
      const toolResults: Array<{
        type: string;
        tool_use_id: string;
        content: string;
      }> = [];

      for (const part of msg.parts) {
        if (part.type === "text") {
          textParts.push(part.content);
        } else if (part.type === "code") {
          textParts.push(`\`\`\`${part.language}\n${part.content}\n\`\`\``);
        } else if (part.type === "tool") {
          toolCalls.push({
            type: "tool_use",
            id: part.tool.id,
            name: part.tool.tool,
            input: part.tool.args as Record<string, unknown>,
          });
          if (part.result !== undefined) {
            toolResults.push({
              type: "tool_result",
              tool_use_id: part.tool.id,
              content: part.result,
            });
          }
        }
      }

      if (msg.role === "user") {
        if (textParts.length > 0) {
          messages.push({ role: "user", content: textParts.join("\n\n") });
        }
      } else if (msg.role === "assistant") {
        if (toolCalls.length > 0) {
          const content: Array<{ type: string; [key: string]: unknown }> = [];
          if (textParts.length > 0) {
            content.push({ type: "text", text: textParts.join("\n\n") });
          }
          content.push(...toolCalls);
          messages.push({ role: "assistant", content });
        } else if (textParts.length > 0) {
          messages.push({
            role: "assistant",
            content: textParts.join("\n\n"),
          });
        }

        if (toolResults.length > 0) {
          messages.push({ role: "user", content: toolResults });
        }
      }
    }
  } else {
    // If there are previous tool results, they come AFTER an assistant message
    // with tool_use blocks (Anthropic message protocol pattern).
    if (opts.toolResults && opts.toolResults.length > 0) {
      const assistantContent: Array<{
        type: string;
        [key: string]: unknown;
      }> = [];
      for (const tr of opts.toolResults) {
        assistantContent.push({
          type: "tool_use",
          id: tr.toolCallId,
          name: tr.name || "unknown",
          input: tr.input || {},
        });
      }
      messages.push({ role: "assistant", content: assistantContent });

      const userContent: Array<{ type: string; [key: string]: unknown }> = [];
      for (const tr of opts.toolResults) {
        userContent.push({
          type: "tool_result",
          tool_use_id: tr.toolCallId,
          content: tr.result || "",
        });
      }
      messages.push({ role: "user", content: userContent });
    }

    if (opts.prompt) {
      messages.push({ role: "user", content: opts.prompt });
    }
  }

  const body: Record<string, unknown> = {
    model,
    max_tokens: opts.maxTokens || 4096,
    messages,
  };

  if (opts.tools && opts.tools.length > 0) {
    body.tools = opts.tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: {
        type: "object",
        properties: tool.parameters.properties || {},
        required: tool.parameters.required || [],
      },
    }));
  }

  if (opts.temperature !== undefined) body.temperature = opts.temperature;

  return { body, model };
}

function authHeaders(): Record<string, string> {
  const apiKey = getApiKey("minimax");
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
    "x-api-key": apiKey,
    "anthropic-version": ANTHROPIC_VERSION,
  };
}

function stopReasonFrom(
  raw: unknown,
  hasToolCalls: boolean,
): ExecuteResult["stopReason"] {
  if (raw === "end_turn" || raw === "stop") {
    return hasToolCalls ? "tool_use" : "stop";
  }
  if (raw === "max_tokens") return "max_tokens";
  if (raw === "tool_use") return "tool_use";
  return "unknown";
}

function createMiniMaxProvider(_apiKey: string): AIProvider {
  async function execute(opts: ExecuteOptions): Promise<ExecuteResult> {
    const { body, model } = buildRequestBody(opts);

    const response = await fetch(BASE_URL, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify(body),
      signal: opts.abortSignal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`MiniMax API error ${response.status}: ${errorText}`);
    }

    const data = (await response.json()) as {
      content: Array<{
        type: string;
        text?: string;
        thinking?: string;
        id?: string;
        name?: string;
        input?: Record<string, unknown>;
      }>;
      usage: { input_tokens: number; output_tokens: number };
      stop_reason: string;
    };

    const textParts = data.content?.filter((c) => c.type === "text");
    const thinkingParts = data.content?.filter((c) => c.type === "thinking");
    const content =
      textParts
        ?.map((c) => c.text || "")
        .join("\n")
        .trim() || "";
    const thinking =
      thinkingParts
        ?.map((c) => c.thinking || "")
        .join("\n")
        .trim() || undefined;

    const toolCalls =
      data.content
        ?.filter((c) => c.type === "tool_use")
        .map((c) => ({
          id: c.id || `tool-${Date.now()}`,
          name: c.name || "unknown",
          args: c.input || {},
        })) ?? [];

    return {
      content,
      thinking,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      usage: data.usage
        ? {
            inputTokens: data.usage.input_tokens,
            outputTokens: data.usage.output_tokens,
          }
        : undefined,
      stopReason: stopReasonFrom(data.stop_reason, toolCalls.length > 0),
      provider: PROVIDER_INFO.id,
      model,
    };
  }

  async function* stream(
    opts: ExecuteOptions,
  ): AsyncGenerator<ProviderChunk> {
    const { body } = buildRequestBody(opts);
    body.stream = true;

    const response = await fetch(BASE_URL, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify(body),
      signal: opts.abortSignal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      yield {
        type: "error",
        error: `MiniMax API error ${response.status}: ${errorText}`,
      };
      yield { type: "done", stopReason: "unknown" };
      return;
    }
    if (!response.body) {
      yield { type: "error", error: "MiniMax API: empty response body" };
      yield { type: "done", stopReason: "unknown" };
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    // Per-content-block state for tool_use blocks: block index → accumulator.
    const toolBlocks = new Map<
      number,
      { id: string; name: string; partialJson: string }
    >();
    let hasToolCalls = false;
    let stopReason: ExecuteResult["stopReason"] = "stop";
    let inputTokens: number | undefined;
    let outputTokens: number | undefined;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // SSE events are separated by a blank line ("\n\n").
        let sep: number;
        while ((sep = buffer.indexOf("\n\n")) !== -1) {
          const eventBlock = buffer.slice(0, sep);
          buffer = buffer.slice(sep + 2);

          const dataPayload = eventBlock
            .split("\n")
            .filter((l) => l.startsWith("data:"))
            .map((l) => l.slice(5).trim())
            .join("\n");
          if (!dataPayload || dataPayload === "[DONE]") continue;

          let event: any;
          try {
            event = JSON.parse(dataPayload);
          } catch {
            continue;
          }

          switch (event.type) {
            case "message_start":
              if (event.message?.usage?.input_tokens != null) {
                inputTokens = event.message.usage.input_tokens;
              }
              break;
            case "content_block_start": {
              const block = event.content_block;
              if (block?.type === "tool_use") {
                toolBlocks.set(event.index, {
                  id: block.id ?? `tool-${Date.now()}-${event.index}`,
                  name: block.name ?? "unknown",
                  partialJson: "",
                });
              }
              break;
            }
            case "content_block_delta": {
              const delta = event.delta;
              if (delta?.type === "text_delta" && delta.text) {
                yield { type: "text_delta", delta: delta.text };
              } else if (delta?.type === "thinking_delta" && delta.thinking) {
                yield { type: "thinking_delta", delta: delta.thinking };
              } else if (delta?.type === "input_json_delta") {
                const state = toolBlocks.get(event.index);
                if (state) state.partialJson += delta.partial_json ?? "";
              }
              break;
            }
            case "content_block_stop": {
              const state = toolBlocks.get(event.index);
              if (state) {
                let args: Record<string, unknown> = {};
                if (state.partialJson) {
                  try {
                    args = JSON.parse(state.partialJson) as Record<
                      string,
                      unknown
                    >;
                  } catch {
                    // Malformed partial JSON — surface the tool call with empty
                    // args rather than aborting the whole stream.
                  }
                }
                yield {
                  type: "tool_call",
                  id: state.id,
                  name: state.name,
                  args,
                };
                hasToolCalls = true;
                toolBlocks.delete(event.index);
              }
              break;
            }
            case "message_delta": {
              const sr = event.delta?.stop_reason;
              stopReason = stopReasonFrom(sr, hasToolCalls);
              if (event.usage?.output_tokens != null) {
                outputTokens = event.usage.output_tokens;
              }
              break;
            }
            case "message_stop":
              break;
            case "error":
              yield {
                type: "error",
                error:
                  typeof event.error === "string"
                    ? event.error
                    : JSON.stringify(event.error),
              };
              break;
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    if (inputTokens != null || outputTokens != null) {
      yield {
        type: "usage",
        usage: {
          inputTokens: inputTokens ?? 0,
          outputTokens: outputTokens ?? 0,
        },
      };
    }
    yield { type: "done", stopReason };
  }

  return { info: PROVIDER_INFO, execute, stream };
}

registerProvider("minimax", {
  info: PROVIDER_INFO,
  create: createMiniMaxProvider,
});
