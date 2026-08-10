// =============================================================================
// Trace assembly — folds the flat rollout event log into paired spans.
//
// The log is append-only and deliberately dumb: a `model.request` and the
// `model.response` that closes it are two independent lines. Pairing them is
// what turns the log into a timeline, and — more importantly — what surfaces
// the requests that were never closed at all. An unterminated request is a
// hang, and it is invisible until something looks for the missing partner.
//
// Pure: no IO, no formatting. Rendering lives in trace-render.ts.
// =============================================================================

import type { RolloutEvent } from "./types.js";

export type SpanStatus = "ok" | "error" | "hung";

export interface ModelSpan {
  turnId: string;
  provider: string;
  model: string;
  startedAt: number;
  status: SpanStatus;
  /** Wall time of the call. For a hung span, time until the log went quiet. */
  duration_ms: number;
  ttft_ms?: number;
  messageCount: number;
  toolCount: number;
  promptChars: number;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  toolCalls: string[];
  errorKind?: "stall" | "abort" | "provider";
  error?: string;
}

export interface ToolSpan {
  tool: string;
  startedAt: number;
  duration_ms: number;
}

export interface Trace {
  sessionId: string;
  startedAt: number;
  endedAt: number;
  wall_ms: number;
  modelSpans: ModelSpan[];
  toolSpans: ToolSpan[];
  /** Sum of model call time; the number that usually explains a slow session. */
  model_ms: number;
  tool_ms: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  /** True when any request never got a terminator — the session is/was hung. */
  hung: boolean;
}

/**
 * `now` is injected so `--follow` can age an in-flight request against the
 * wall clock, while a post-mortem ages it against the last thing that
 * happened. Defaulting to the final event keeps a finished trace stable no
 * matter when it is read.
 */
export function buildTrace(
  sessionId: string,
  events: RolloutEvent[],
  now?: number,
): Trace {
  const modelSpans: ModelSpan[] = [];
  const toolSpans: ToolSpan[] = [];
  const open: ModelSpan[] = [];
  const pendingTools = new Map<string, number>();

  for (const event of events) {
    switch (event.type) {
      case "model.request": {
        const span: ModelSpan = {
          turnId: event.turnId,
          provider: event.provider,
          model: event.model,
          startedAt: event.timestamp,
          status: "hung",
          duration_ms: 0,
          messageCount: event.messageCount,
          toolCount: event.toolCount,
          promptChars: event.promptChars,
          toolCalls: [],
        };
        modelSpans.push(span);
        open.push(span);
        break;
      }
      case "model.first_token": {
        const span = takeOpen(open, event.turnId, false);
        if (span) span.ttft_ms = event.ttft_ms;
        break;
      }
      case "model.response": {
        const span = takeOpen(open, event.turnId, true);
        if (!span) break;
        span.status = "ok";
        span.duration_ms = event.duration_ms;
        span.ttft_ms = event.ttft_ms ?? span.ttft_ms;
        span.inputTokens = event.inputTokens;
        span.outputTokens = event.outputTokens;
        span.cacheReadTokens = event.cacheReadTokens;
        span.toolCalls = event.toolCalls;
        break;
      }
      case "model.error": {
        const span = takeOpen(open, event.turnId, true);
        if (!span) break;
        span.status = "error";
        span.duration_ms = event.duration_ms;
        span.errorKind = event.kind;
        span.error = event.error;
        break;
      }
      case "function.call":
        pendingTools.set(event.tool, event.timestamp);
        break;
      case "function.output":
        toolSpans.push({
          tool: event.tool,
          startedAt: pendingTools.get(event.tool) ?? event.timestamp,
          duration_ms: event.duration_ms,
        });
        pendingTools.delete(event.tool);
        break;
    }
  }

  const startedAt = events[0]?.timestamp ?? 0;
  const endedAt = events[events.length - 1]?.timestamp ?? startedAt;
  // Everything still open never terminated. Age it against the clock so the
  // report says how long it has been hanging, not zero.
  const asOf = now ?? endedAt;
  for (const span of open)
    span.duration_ms = Math.max(0, asOf - span.startedAt);

  return {
    sessionId,
    startedAt,
    endedAt,
    wall_ms: Math.max(0, (now ?? endedAt) - startedAt),
    modelSpans,
    toolSpans,
    model_ms: modelSpans.reduce((n, s) => n + s.duration_ms, 0),
    tool_ms: toolSpans.reduce((n, s) => n + s.duration_ms, 0),
    inputTokens: sum(modelSpans, "inputTokens"),
    outputTokens: sum(modelSpans, "outputTokens"),
    cacheReadTokens: sum(modelSpans, "cacheReadTokens"),
    hung: open.length > 0,
  };
}

/**
 * Matching prefers the same turnId, but falls back to the oldest open span:
 * turnIds restart at `turn-0` when a session resumes, and a mismatch must not
 * silently orphan a real response into a phantom hang.
 */
function takeOpen(
  open: ModelSpan[],
  turnId: string,
  remove: boolean,
): ModelSpan | undefined {
  let index = open.findIndex((s) => s.turnId === turnId);
  if (index === -1) index = open.length > 0 ? 0 : -1;
  if (index === -1) return undefined;
  const span = open[index];
  if (remove) open.splice(index, 1);
  return span;
}

function sum(spans: ModelSpan[], key: keyof ModelSpan): number {
  return spans.reduce((n, s) => n + ((s[key] as number | undefined) ?? 0), 0);
}
