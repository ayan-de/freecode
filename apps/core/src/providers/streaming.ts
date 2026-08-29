// =============================================================================
// AI-SDK streaming adapter
// Normalizes the AI SDK v6 `streamText().fullStream` iterable into our
// ProviderChunk shape, so every provider that uses the AI SDK can share the
// same transform. Non-AI-SDK providers (e.g. MiniMax) can bypass this.
// =============================================================================

import type { ProviderChunk, ExecuteResult } from "./types.js";
import { mapUsage } from "./provider-shared.js";

type SdkChunk = { type: string } & Record<string, unknown>;

function finishReasonToStop(reason: unknown): ExecuteResult["stopReason"] {
  if (reason === "tool-calls") return "tool_use";
  if (reason === "length") return "max_tokens";
  if (reason === "stop") return "stop";
  return "unknown";
}

// Some providers name the field `text`, others `textDelta`, depending on the
// SDK minor version. Read whichever is present.
function pickDelta(chunk: SdkChunk): string {
  const t = chunk.text ?? chunk.textDelta ?? chunk.delta ?? "";
  return typeof t === "string" ? t : "";
}

export async function* normalizeAiSdkStream(
  fullStream: AsyncIterable<SdkChunk>,
): AsyncGenerator<ProviderChunk> {
  let stopReason: ExecuteResult["stopReason"] = "stop";
  let usageEmitted = false;
  let echoedModel: string | undefined;

  for await (const chunk of fullStream) {
    switch (chunk.type) {
      // The only part of the stream that carries what the provider actually
      // served. A multi-step call emits one per step; they should agree, and
      // if they ever don't, the last is the one that produced the final answer.
      case "finish-step": {
        const id = (chunk.response as { modelId?: unknown } | undefined)
          ?.modelId;
        if (typeof id === "string" && id) echoedModel = id;
        break;
      }
      case "text-delta":
      case "text": {
        const delta = pickDelta(chunk);
        if (delta) yield { type: "text_delta", delta };
        break;
      }
      case "reasoning":
      case "reasoning-delta": {
        const delta = pickDelta(chunk);
        if (delta) yield { type: "thinking_delta", delta };
        break;
      }
      case "tool-call": {
        const id = (chunk.toolCallId ?? chunk.id) as string | undefined;
        const name = (chunk.toolName ?? chunk.name) as string | undefined;
        const raw = chunk.input ?? chunk.args ?? {};
        // When the model's tool-call JSON can't be parsed — most often because
        // it was cut off mid-argument by the output-token cap — the AI SDK does
        // not throw: `parseToolCall`'s catch-all emits a tool-call part whose
        // `input` is the RAW JSON STRING, flagged `invalid: true`. Blindly
        // casting that to a Record poisons the session permanently: the string
        // is stored in history, reloaded on resume, and re-sent every turn as
        // `tool_use.input`, which providers reject ("Input should be a valid
        // dictionary") — every subsequent request fails before reaching the
        // model. Fail the turn here instead, while the damage is recoverable.
        if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
          yield {
            type: "error",
            error:
              `Tool call "${name ?? "unknown"}" had malformed arguments (likely truncated by the ` +
              `output token limit). Retry with a smaller change, or raise maxTokens.`,
          };
          break;
        }
        const args = raw as Record<string, unknown>;
        if (id && name) yield { type: "tool_call", id, name, args };
        break;
      }
      case "finish": {
        stopReason = finishReasonToStop(chunk.finishReason);
        // The AI SDK's "finish" fullStream part carries `totalUsage`, not
        // `usage` (that field only exists on the per-step "finish-step"
        // part) — reading chunk.usage here was always undefined, so no
        // usage chunk was ever emitted and callers saw 0 tokens on completion.
        // `mapUsage` (providers/provider-shared.ts) does the same
        // field-renaming the execute() path uses, so streaming and
        // non-streaming publish the identical shape. Provider metadata
        // (Anthropic wire envelope, OpenAI `prompt_cache_key`, …) is
        // preserved verbatim for billing audit and for fields we don't
        // normalize.
        const totalUsage = chunk.totalUsage;
        const providerMetadata = chunk.providerMetadata as
          | Record<string, unknown>
          | undefined;
        const normalized = mapUsage(
          totalUsage as Parameters<typeof mapUsage>[0],
          providerMetadata,
        );
        if (normalized) {
          yield { type: "usage", usage: normalized };
          usageEmitted = true;
        }
        break;
      }
      case "error": {
        const err = chunk.error;
        yield {
          type: "error",
          error: err instanceof Error ? err.message : String(err),
        };
        break;
      }
      // Ignored chunk types: tool-input-start / tool-input-delta / tool-input-end
      // (tool call is emitted whole as "tool-call" once complete), start / step-*
      default:
        break;
    }
  }

  if (!usageEmitted) {
    // some finish events omit usage; still emit a done chunk
  }
  yield { type: "done", stopReason, echoedModel };
}
