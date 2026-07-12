// =============================================================================
// AI-SDK streaming adapter
// Normalizes the AI SDK v6 `streamText().fullStream` iterable into our
// ProviderChunk shape, so every provider that uses the AI SDK can share the
// same transform. Non-AI-SDK providers (e.g. MiniMax) can bypass this.
// =============================================================================

import type { ProviderChunk, ExecuteResult } from "./types.js";

type SdkChunk = { type: string } & Record<string, unknown>;

function finishReasonToStop(
  reason: unknown,
): ExecuteResult["stopReason"] {
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

  for await (const chunk of fullStream) {
    switch (chunk.type) {
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
        const args = (chunk.input ?? chunk.args ?? {}) as Record<
          string,
          unknown
        >;
        if (id && name) yield { type: "tool_call", id, name, args };
        break;
      }
      case "finish": {
        stopReason = finishReasonToStop(chunk.finishReason);
        const u = chunk.usage as
          | {
              inputTokens?: number;
              outputTokens?: number;
              cacheCreationInputTokens?: number;
              cacheReadInputTokens?: number;
            }
          | undefined;
        if (u) {
          yield {
            type: "usage",
            usage: {
              inputTokens: u.inputTokens ?? 0,
              outputTokens: u.outputTokens ?? 0,
              cacheCreationInputTokens: u.cacheCreationInputTokens,
              cacheReadInputTokens: u.cacheReadInputTokens,
            },
          };
          usageEmitted = true;
        }
        break;
      }
      case "error": {
        const err = chunk.error;
        yield { type: "error", error: err instanceof Error ? err.message : String(err) };
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
  yield { type: "done", stopReason };
}
