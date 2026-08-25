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
      anthropic: { cacheControl: anthropicCacheControl() },
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
  return system.map((block, i) => {
    debugSegment(`system[${i}]${block.cache ? " (cached)" : ""}`, block.text);
    const part: {
      role: "system";
      content: string;
      providerOptions?: unknown;
    } = { role: "system", content: block.text };
    if (block.cache) {
      part.providerOptions = {
        anthropic: { cacheControl: anthropicCacheControl() },
      };
    }
    return part;
  });
}

/**
 * `FREECODE_DEBUG_CACHE=1` logs a fingerprint of each cacheable prompt segment.
 *
 * A cache read only happens when the whole prefix up to a breakpoint is
 * byte-identical to a stored one, so when the hit rate is low the question is
 * always "which segment moved?" — and counters cannot answer it. Comparing
 * these lines across two consecutive turns does: whichever hash changes is the
 * one breaking the prefix.
 */
function debugSegment(label: string, text: string): void {
  if (process.env.FREECODE_DEBUG_CACHE !== "1") return;
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = (Math.imul(hash, 31) + text.charCodeAt(i)) | 0;
  }
  // Straight to stderr, not through `logger`: core speaks JSON-RPC over
  // stdout, so anything console.log'd there is swallowed by the frontend's
  // protocol reader and never reaches the user. stderr is the channel the TUI
  // actually surfaces.
  process.stderr.write(
    `[cache-debug] ${label} len=${text.length} hash=${(hash >>> 0).toString(16)}\n`,
  );
}

export type CacheTtl = "5m" | "1h";

/**
 * How long a cache entry survives between turns. `FREECODE_CACHE_TTL=1h`
 * opts into Anthropic's extended cache; anything else keeps the 5m default.
 *
 * The trade is a write-rate increase (1.25x -> 2x base) against far fewer cold
 * writes. Per-turn writes are small — Anthropic bills cache creation for the
 * *delta* once the head of the prefix hits — so the number that dominates is
 * how often the whole context gets re-written from cold. At 5m that is every
 * pause longer than a coffee refill; one such gap per hour already makes 1h
 * cheaper (2x once beats 1.25x twice), and an interactive session with a human
 * reading diffs in the loop has many.
 *
 * Left off by default because the reverse case is real: a fast unattended run
 * with no gaps pays the 2x write rate for a durability it never uses. Sessions
 * differ too much to guess, so this is a knob rather than a new default.
 *
 * Read per call — matching `getCompactTarget()` in compaction/tokens.ts — so a
 * long-lived daemon and the tests can both change it without a module reload.
 */
export function getCacheTtl(): CacheTtl {
  const raw = process.env.FREECODE_CACHE_TTL;
  if (raw === undefined || raw === "") return "5m";
  if (raw === "5m" || raw === "1h") return raw;
  logger.warn(
    `FREECODE_CACHE_TTL="${raw}" is not a supported value (expected "5m" or ` +
      `"1h"); falling back to "5m".`,
  );
  return "5m";
}

/**
 * The `cacheControl` value for Anthropic-shaped providers.
 *
 * `ttl` is omitted entirely at 5m rather than sent explicitly. 5m is already
 * the server-side default, so omitting it keeps the request bytes identical to
 * what shipped before this knob existed — the default path cannot regress, and
 * there is no new field for a gateway to choke on.
 */
function anthropicCacheControl(): { type: "ephemeral"; ttl?: CacheTtl } {
  const ttl = getCacheTtl();
  return ttl === "1h" ? { type: "ephemeral", ttl } : { type: "ephemeral" };
}

/**
 * Cache-breakpoint markers, keyed by every provider flavor that understands
 * one. The AI SDK routes `providerOptions` by key and ignores the rest, so
 * setting them all costs nothing and means a model reached through OpenRouter
 * or an OpenAI-compatible gateway caches as well as a direct Anthropic one.
 * Same approach as opencode's `applyCaching` (provider/transform.ts:335).
 *
 * `ttl` rides along only on `anthropic` and `openrouter`. Those are the two
 * whose acceptance of the field is verified — the AI SDK's own zod schema for
 * the former (`@ai-sdk/anthropic` dist/index.d.ts:195, `"5m" | "1h"`), and
 * OpenRouter's documented Anthropic `cache_control` passthrough for the
 * latter. The rest are left at the bare marker: `openaiCompatible` is a raw
 * passthrough to whatever gateway is behind it (MiniMax, Z.ai), so an
 * unrecognised field there risks a 400 on the primary path to buy nothing,
 * and `bedrock`'s `cachePoint` has no TTL concept at all.
 */
function cacheProviderOptions(): Record<string, unknown> {
  return {
    anthropic: { cacheControl: anthropicCacheControl() },
    openrouter: { cacheControl: anthropicCacheControl() },
    openaiCompatible: { cache_control: { type: "ephemeral" } },
    alibaba: { cacheControl: { type: "ephemeral" } },
    bedrock: { cachePoint: { type: "default" } },
  };
}

/**
 * Marks two cache breakpoints: a read anchor and a write anchor.
 *
 * Providers check for a cache hit *at each breakpoint*, so a marker on the
 * final message alone describes a prefix ending in content the model has never
 * seen — it can only ever write an entry, never read one. A second marker has
 * to sit exactly where the previous request ended, because that is the only
 * prefix an entry was written for.
 *
 * "Two back" is not that position here. `convertToCoreMessages` expands one
 * turn into an `assistant` message carrying the tool calls plus a `tool`
 * message carrying the results, so a plain `.slice(-2)` — opencode's rule,
 * written for a one-message-per-turn shape — lands on two messages that are
 * *both new*. Measured on MiniMax-M3: reads pinned at ~7K (the system prefix)
 * while input grew to 81K, never scaling with history.
 *
 * The previous request ended immediately before the newest assistant message,
 * whether or not that turn used tools, so that is where the read anchor goes.
 * jcode arrives at the same place from the other direction: a READ marker on
 * the second-to-last assistant message.
 *
 * Mutates in place, matching the AI SDK message objects the callers just built.
 */
export function applyMessageCaching(messages: ModelMessage[]): void {
  const anchors: ModelMessage[] = [];

  // Write anchor: the tail, so this request's full prefix is stored for next
  // time. Skipped for system-only input, which has no conversation to cache.
  const last = messages[messages.length - 1];
  if (last && last.role !== "system") anchors.push(last);

  // Read anchor: the message immediately before the newest assistant message,
  // i.e. the write anchor of the previous request.
  let lastAssistant = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "assistant") {
      lastAssistant = i;
      break;
    }
  }
  const readAnchor = messages[lastAssistant - 1];
  if (
    lastAssistant > 0 &&
    readAnchor.role !== "system" &&
    readAnchor !== last
  ) {
    anchors.push(readAnchor);
  }

  // Resolved once so both anchors carry the same TTL, whatever the env says.
  const providerOptions = cacheProviderOptions();

  for (const msg of anchors) {
    const idx = messages.indexOf(msg);
    debugSegment(
      `messages[0..${idx}] ${msg === last ? "write-anchor" : "read-anchor"}`,
      JSON.stringify(messages.slice(0, idx + 1)),
    );
    if (typeof msg.content === "string") {
      // A bare string carries nowhere to hang providerOptions; promote it to a
      // single text part so the marker has somewhere to live.
      msg.content = [
        {
          type: "text",
          text: msg.content,
          providerOptions: { ...providerOptions },
        },
      ] as unknown as typeof msg.content;
      continue;
    }
    if (!Array.isArray(msg.content) || msg.content.length === 0) continue;
    const lastPart = msg.content[msg.content.length - 1];
    if (lastPart && typeof lastPart === "object") {
      (lastPart as { providerOptions?: unknown }).providerOptions = {
        ...((lastPart as { providerOptions?: object }).providerOptions ?? {}),
        ...providerOptions,
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
 * `streamText()`'s `onError` option, passed to every provider's stream call.
 *
 * A stream failure doesn't reject `streamText()`'s promise — it arrives as an
 * `"error"` part on `fullStream`, which `normalizeAiSdkStream` (streaming.ts)
 * already turns into a clean `ProviderChunk` for the loop/RecoveryManager to
 * handle. Without an explicit `onError`, the SDK's own default is
 * `console.error(error)`: the full `APICallError` — `requestBodyValues`,
 * `responseHeaders`, a stack with no sourcemap in the compiled binary — dumped
 * straight to the terminal on every stream error, duplicate of and uglier than
 * the message the user actually sees. No-op here; the error is already handled.
 */
export function silenceStreamErrors(): void {}

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
  warnOnFallback = true,
): string {
  if (requested) return requested;
  if (warnOnFallback) {
    logger.warn(
      `[${providerId}] no model specified; falling back to "${defaultModel}". ` +
        `Set one in ~/.freecode/config.json under current.model — the default ` +
        `may have a smaller context window than the model you expect.`,
    );
  }
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
