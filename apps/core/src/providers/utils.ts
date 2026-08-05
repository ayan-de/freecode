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
):
  | Record<
      string,
      { description: string; inputSchema: unknown; providerOptions?: unknown }
    >
  | undefined {
  if (!tools || tools.length === 0) return undefined;
  const result = tools.reduce(
    (acc, t) => {
      acc[t.name] = {
        description: t.description,
        inputSchema: jsonSchema(t.parameters as Record<string, unknown>),
      };
      return acc;
    },
    {} as Record<
      string,
      { description: string; inputSchema: unknown; providerOptions?: unknown }
    >,
  );
  // Cache the entire tool schema block — otherwise it's billed as full-price
  // input tokens on every turn instead of the ~10% cache-read rate, even
  // though the system prompt right after it is cached. Anthropic caches
  // everything up to and including the marked block, so tagging the last
  // tool caches the whole tools array.
  const lastTool = tools[tools.length - 1];
  if (lastTool) {
    result[lastTool.name].providerOptions = {
      anthropic: { cacheControl: { type: "ephemeral" } },
    };
  }
  return result;
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

/**
 * Cache-breakpoint markers, keyed by every provider flavor that understands
 * one. The AI SDK routes `providerOptions` by key and ignores the rest, so
 * setting them all costs nothing and means a model reached through OpenRouter
 * or an OpenAI-compatible gateway caches as well as a direct Anthropic one.
 * Same approach as opencode's `applyCaching` (provider/transform.ts:335).
 */
const CACHE_PROVIDER_OPTIONS = {
  anthropic: { cacheControl: { type: "ephemeral" } },
  openrouter: { cacheControl: { type: "ephemeral" } },
  openaiCompatible: { cache_control: { type: "ephemeral" } },
  alibaba: { cacheControl: { type: "ephemeral" } },
  bedrock: { cachePoint: { type: "default" } },
} as const;

/**
 * Marks the last TWO non-system messages as cache breakpoints.
 *
 * The count is the whole point. Providers check for a cache hit *at each
 * breakpoint*, so a single marker on the final message describes a prefix that
 * always ends in content the model has never seen — it can only ever write a
 * new entry, never read one. The second-to-last message is the read anchor: it
 * was the final message on the previous turn, so an entry exists at exactly
 * that prefix.
 *
 * With one marker, a MiniMax-M3 session read ~7-10K tokens per request (the
 * system blocks, which do have stable breakpoints) and never cached a single
 * conversation message, even at 86K input — a 6.4% hit rate that looked like
 * the provider ignoring cache_control. It was this instead.
 *
 * jcode calls the same arrangement a sliding two-marker window; opencode takes
 * `.slice(-2)` of the non-system messages for it.
 *
 * Mutates in place, matching the AI SDK message objects the callers just built.
 */
export function applyMessageCaching(messages: ModelMessage[]): void {
  const anchors = messages.filter((m) => m.role !== "system").slice(-2);
  for (const msg of anchors) {
    if (typeof msg.content === "string") {
      // A bare string carries nowhere to hang providerOptions; promote it to a
      // single text part so the marker has somewhere to live.
      msg.content = [
        {
          type: "text",
          text: msg.content,
          providerOptions: { ...CACHE_PROVIDER_OPTIONS },
        },
      ] as unknown as typeof msg.content;
      continue;
    }
    if (!Array.isArray(msg.content) || msg.content.length === 0) continue;
    const lastPart = msg.content[msg.content.length - 1];
    if (lastPart && typeof lastPart === "object") {
      (lastPart as { providerOptions?: unknown }).providerOptions = {
        ...((lastPart as { providerOptions?: object }).providerOptions ?? {}),
        ...CACHE_PROVIDER_OPTIONS,
      };
    }
  }
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
 * Ceiling on the tokens any provider reserves for a reply.
 *
 * Providers count `max_tokens` against the same context window as the input —
 * MiniMax rejects the request outright when the two exceed it — so every token
 * reserved here is one the conversation cannot use. A fixed reservation is
 * also regressive: 64K is 6% of a 1M window but a third of a 196K one, which
 * dragged auto-compaction on MiniMax-M2 down to firing at 60% occupancy.
 *
 * 32K matches opencode's OUTPUT_TOKEN_MAX and is still ~128KB of output — far
 * more than a single file write needs, so it keeps the headroom the old 64K
 * was raised to provide. See also claude-code, which caps the equivalent
 * reservation at 20K (`MAX_OUTPUT_TOKENS_FOR_SUMMARY`).
 */
export const OUTPUT_TOKEN_CAP = 32_000;

/**
 * Retries are owned by `RecoveryManager`, not the AI SDK.
 *
 * The SDK defaults to 2 retries (3 attempts) and treats every 429 as
 * retryable, including a hard "you are out of credits" quota rejection that
 * can never succeed. Worse, its attempts multiply with ours — its 3 against
 * the 429 policy's 5 is up to 15 full-conversation round trips for one turn.
 *
 * Leaving it at 0 puts every retry decision in one place, where a quota error
 * can be told apart from a transient rate limit and the provider's own
 * `retry-after` header is honored.
 */
export const PROVIDER_MAX_RETRIES = 0;

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
