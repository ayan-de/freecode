import type { ModelMessage, AssistantModelMessage, ToolModelMessage } from "ai";
import { jsonSchema } from "ai";
import type { Message } from "../agent/types.js";
import type { MultimodalContentPart, SystemBlock, ToolDef } from "./types.js";
import { logger } from "../utils/logger.js";

/**
 * Converts FreeCode's ToolDef[] into the AI SDK's tools map, wrapping each
 * inputSchema with the SDK's own `jsonSchema()` helper instead of passing a
 * raw object. asSchema() (called internally by the SDK when building the
 * request and when validating a returned tool call's arguments) treats an
 * unwrapped plain object as ambiguous: it checks for a `"~standard"` marker
 * to detect Zod schemas, and falls back to calling the object AS A FUNCTION
 * otherwise — `schema()` — which throws "H is not a function" for a plain
 * JSON Schema object, or can misroute into Zod's own toJSONSchema internals
 * if the object's shape coincidentally satisfies that check. jsonSchema()
 * tags the object unambiguously, skipping all of that.
 */
export function buildToolsParam(
  tools: ToolDef[] | undefined,
): Record<string, { description: string; inputSchema: unknown }> | undefined {
  if (!tools || tools.length === 0) return undefined;
  return tools.reduce(
    (acc, t) => {
      acc[t.name] = {
        description: t.description,
        inputSchema: jsonSchema(t.parameters as Record<string, unknown>),
      };
      return acc;
    },
    {} as Record<string, { description: string; inputSchema: unknown }>,
  );
}

/**
 * Builds the AI SDK `system` param for Anthropic-shaped providers (anthropic,
 * minimax, zai). The SDK validates a system array against
 * `{ role: "system", content: string }` — a `{ type: "text", text }`
 * content-part shape fails `standardizePrompt`'s check with
 * "system must be a string, SystemModelMessage, or array of SystemModelMessage".
 */
export function buildAnthropicSystemParam(
  system: string | SystemBlock[],
):
  | string
  | Array<{ role: "system"; content: string; providerOptions?: unknown }> {
  if (typeof system === "string") return system;
  return system.map((block) => {
    const part: {
      role: "system";
      content: string;
      providerOptions?: unknown;
    } = { role: "system", content: block.text };
    if (block.cache) {
      part.providerOptions = {
        anthropic: { cacheControl: { type: "ephemeral" } },
      };
    }
    return part;
  });
}

/** True only for a JSON object — the shape providers accept as tool_use.input. */
export function isPlainObject(
  value: unknown,
): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Transforms FreeCode internal Message structures to Vercel AI SDK ModelMessage formats.
 * Correctly splits assistant tool-calls and their results into consecutive assistant and tool messages.
 */
export function convertToCoreMessages(messages: Message[]): ModelMessage[] {
  const coreMessages: ModelMessage[] = [];

  for (const msg of messages) {
    if (msg.role === "user") {
      // Check if any part is an image - if so, use array content format for vision
      const hasImage = msg.parts.some((p) => p.type === "image");

      if (hasImage) {
        // Vision mode: use array content format with image parts
        const contentParts: MultimodalContentPart[] = [];
        for (const part of msg.parts) {
          if (part.type === "text") {
            contentParts.push({ type: "text", text: part.content });
          } else if (part.type === "code") {
            contentParts.push({
              type: "text",
              text: `\`\`\`${part.language}\n${part.content}\n\`\`\``,
            });
          } else if (part.type === "image") {
            // AI SDK expects { type: "image", image: base64 string or URL, mediaType?: string }
            // The SDK handles provider-specific conversion (Anthropic, OpenAI, Gemini, etc.)
            contentParts.push({
              type: "image",
              image: part.data,
              mediaType: part.mediaType,
            });
          }
        }
        coreMessages.push({
          role: "user",
          content: contentParts,
        });
      } else {
        // Text-only mode: simple string content
        const textParts: string[] = [];
        for (const part of msg.parts) {
          if (part.type === "text") {
            textParts.push(part.content);
          } else if (part.type === "code") {
            textParts.push(`\`\`\`${part.language}\n${part.content}\n\`\`\``);
          }
        }
        coreMessages.push({
          role: "user",
          content: textParts.join("\n\n"),
        });
      }
    } else if (msg.role === "assistant") {
      const textParts: string[] = [];
      const toolCalls: Array<{
        type: "tool-call";
        toolCallId: string;
        toolName: string;
        input: unknown;
      }> = [];
      const toolResults: Array<{
        type: "tool-result";
        toolCallId: string;
        toolName: string;
        output: { type: "text"; value: string };
      }> = [];

      for (const part of msg.parts) {
        if (part.type === "text") {
          textParts.push(part.content);
        } else if (part.type === "code") {
          textParts.push(`\`\`\`${part.language}\n${part.content}\n\`\`\``);
        } else if (part.type === "tool") {
          toolCalls.push({
            type: "tool-call",
            toolCallId: part.tool.id,
            toolName: part.tool.tool,
            // Last line of defence before the wire: providers reject a
            // `tool_use.input` that isn't a dictionary, and one bad entry
            // anywhere in history fails every later request in the session.
            // Sessions recorded before the streaming-layer guard can still
            // hold a raw JSON string here — send `{}` rather than brick them.
            input: isPlainObject(part.tool.args) ? part.tool.args : {},
          });
          if (part.result !== undefined) {
            toolResults.push({
              type: "tool-result",
              toolCallId: part.tool.id,
              toolName: part.tool.tool,
              // AI SDK v6 requires a structured ToolResultOutput, not a raw
              // string — otherwise the ModelMessage[] schema rejects it.
              output: {
                type: "text",
                value:
                  typeof part.result === "string"
                    ? part.result
                    : JSON.stringify(part.result),
              },
            });
          }
        }
      }

      // If both text and tool calls exist, pack them as content parts in assistant message
      if (toolCalls.length > 0) {
        const content: any[] = [];
        if (textParts.length > 0) {
          content.push({ type: "text", text: textParts.join("\n\n") });
        }
        content.push(...toolCalls);
        coreMessages.push({
          role: "assistant",
          content,
        } as AssistantModelMessage);
      } else {
        coreMessages.push({
          role: "assistant",
          content: textParts.join("\n\n"),
        });
      }

      // Append tool results as a separate 'tool' role message immediately following the assistant message
      if (toolResults.length > 0) {
        coreMessages.push({
          role: "tool",
          content: toolResults,
        } as ToolModelMessage);
      }
    }
  }

  return coreMessages;
}

/**
 * Resolves the model for a request, falling back to the provider's default.
 *
 * The fallback exists for API callers that omit a model, but it used to be a
 * bare `opts.model || DEFAULT` — so when the model failed to thread through
 * from config.json, requests silently went out on a different model than the
 * one the UI displayed (MiniMax-M3's 1M meter over M2's 196K window, which
 * 400s at ~20% shown). Reaching the default now always says so.
 */
export function resolveModel(
  requested: string | undefined,
  providerId: string,
  defaultModel: string,
): string {
  if (requested) return requested;
  logger.warn(
    `[${providerId}] no model specified; falling back to "${defaultModel}". ` +
      `Set one in ~/.freecode/config.json under current.model — the default ` +
      `may have a smaller context window than the model you expect.`,
  );
  return defaultModel;
}

/** Returns true if any message contains image parts. */
export function messagesContainImages(messages: Message[]): boolean {
  for (const msg of messages) {
    for (const part of msg.parts) {
      if (part.type === "image") return true;
    }
  }
  return false;
}
