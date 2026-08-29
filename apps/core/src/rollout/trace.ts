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

import type { DenySource, RolloutEvent } from "./types.js";

export type SpanStatus = "ok" | "error" | "in_flight" | "hung";

/**
 * How long an unterminated request must sit before it is called a hang rather
 * than a request still in progress.
 *
 * Without this every in-flight call rendered as HUNG the moment `--follow`
 * drew it, and then "recovered" when the response landed — which is not a
 * diagnosis, it is a race against the redraw. The threshold matches the
 * header timeout in `providers/fetch-timeout.ts`: past that point the request
 * should already have been killed, so if it is still open something is wrong.
 */
export const HANG_THRESHOLD_MS = 300_000;

export interface ModelSpan {
  turnId: string;
  provider: string;
  /** What we asked for, from `model.request`. */
  model: string;
  /**
   * What the provider said it served, from `model.response`. Absent when the
   * provider said nothing, when the call errored, or when the span is still
   * open — so `echoedModel !== model` is only a disagreement if it is set.
   */
  echoedModel?: string;
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
  /**
   * Carried for pricing: a cache write bills at 1.25x input on Anthropic, so
   * a fold that dropped it priced writes at 1.0x and understated every cached
   * session. Recorded by `model.response` since that event existed — this is a
   * fold change, not an instrumentation change.
   */
  cacheWriteTokens?: number;
  toolCalls: string[];
  errorKind?: "stall" | "abort" | "provider";
  error?: string;
}

export interface ToolSpan {
  tool: string;
  /**
   * Position in CALL order — the `seq` of the `function.call` that opened it.
   *
   * `toolSpans` is built from `function.output`, which arrives in COMPLETION
   * order: a parallel batch (`Promise.all` in `loop.ts`) can finish a later
   * call first, and before this existed the fold reported that later call as
   * the opening move. `buildTrace` sorts on this, so `toolSpans[0]` is the
   * tool the model actually reached for first.
   *
   * Falls back to the output's own `seq` when the opening call was never
   * logged, which keeps such a span ordered sanely against the rest.
   */
  callSeq: number;
  startedAt: number;
  duration_ms: number;
  /**
   * Arguments the tool was called with, from the paired `function.call`.
   * `function.output` carries no args, so a span whose opening call was lost
   * (truncated log, resumed mid-turn) has none — hence optional.
   */
  args?: Record<string, unknown>;
  /**
   * Whether the tool errored, from `function.output.failed`. Absent on logs
   * written before that field existed — absent means "unknown", not "ok".
   */
  failed?: boolean;
}

/**
 * A call that was refused before it ran, from `function.denied`.
 *
 * Kept in its own array rather than as a flag on `ToolSpan` on purpose.
 * `toolSpans` has seven consumers — the trajectory scorer, the judge's tool
 * list, `harvest`'s drafted `expectTool`, `countRepeatedCalls`, `tool_ms`,
 * evidence, OTLP — and every one of them means "tools that ran". Mixing
 * denials in would keep each of them correct only for as long as each
 * remembered to filter, and a forgotten filter reads as a mutation that never
 * happened. Additive is the shape where the unsafe default is impossible.
 */
export interface DeniedSpan {
  tool: string;
  at: number;
  args?: Record<string, unknown>;
  source: DenySource;
  reason: string;
}

export interface Trace {
  sessionId: string;
  startedAt: number;
  endedAt: number;
  wall_ms: number;
  modelSpans: ModelSpan[];
  /** Tools that RAN. A refused call is in `deniedSpans`, never here. */
  toolSpans: ToolSpan[];
  /** Calls refused before execution. Empty on logs predating the event. */
  deniedSpans: DeniedSpan[];
  /** Sum of model call time; the number that usually explains a slow session. */
  model_ms: number;
  tool_ms: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  /** A request open longer than `HANG_THRESHOLD_MS` — genuinely stuck. */
  hung: boolean;
  /** A request open but still within budget — normal during `--follow`. */
  inFlight: boolean;
  /**
   * Trajectory redirections that fired, and warnings that did not become one.
   * Counts only: the advice text is deliberately absent from the log, so
   * folding it here would have nothing to fold. Keeps `freecode trace` and the
   * OTLP export useful and leak-free.
   */
  redirects: number;
  redirectsSkipped: number;
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
  const deniedSpans: DeniedSpan[] = [];
  const open: ModelSpan[] = [];
  let redirects = 0;
  let redirectsSkipped = 0;
  // Two indexes over the same pending calls. `byId` is exact; `byTool` is the
  // fallback for logs written before `callId` existed, and pops OLDEST-FIRST so
  // two concurrent calls to the same tool still yield ascending call order.
  interface PendingCall {
    startedAt: number;
    callSeq: number;
    args?: Record<string, unknown>;
  }
  const pendingById = new Map<string, PendingCall>();
  const pendingByTool = new Map<string, PendingCall[]>();

  for (const event of events) {
    switch (event.type) {
      case "model.request": {
        const span: ModelSpan = {
          turnId: event.turnId,
          provider: event.provider,
          model: event.model,
          startedAt: event.timestamp,
          // Resolved at the end against the clock. Anything still open is
          // in flight until it has been open longer than a request should be.
          status: "in_flight",
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
        span.echoedModel = event.echoedModel;
        span.duration_ms = event.duration_ms;
        span.ttft_ms = event.ttft_ms ?? span.ttft_ms;
        span.inputTokens = event.inputTokens;
        span.outputTokens = event.outputTokens;
        span.cacheReadTokens = event.cacheReadTokens;
        span.cacheWriteTokens = event.cacheWriteTokens;
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
      case "function.call": {
        const pending: PendingCall = {
          startedAt: event.timestamp,
          callSeq: event.seq,
          args: event.args,
        };
        if (event.callId) {
          pendingById.set(event.callId, pending);
        } else {
          const queue = pendingByTool.get(event.tool) ?? [];
          queue.push(pending);
          pendingByTool.set(event.tool, queue);
        }
        break;
      }
      case "function.output": {
        let pending: PendingCall | undefined;
        if (event.callId && pendingById.has(event.callId)) {
          pending = pendingById.get(event.callId);
          pendingById.delete(event.callId);
        } else {
          pending = pendingByTool.get(event.tool)?.shift();
        }
        toolSpans.push({
          tool: event.tool,
          callSeq: pending?.callSeq ?? event.seq,
          startedAt: pending?.startedAt ?? event.timestamp,
          duration_ms: event.duration_ms,
          ...(pending?.args ? { args: pending.args } : {}),
          ...(event.failed === undefined ? {} : { failed: event.failed }),
        });
        break;
      }
      // No pairing: the refusal is the whole story, and `function.call` was
      // never written for it. Duration is meaningless — nothing ran.
      case "function.denied":
        deniedSpans.push({
          tool: event.tool,
          at: event.timestamp,
          ...(event.args ? { args: event.args } : {}),
          source: event.source,
          reason: event.reason,
        });
        break;
      case "redirect.triggered":
        redirects++;
        break;
      case "redirect.skipped":
        redirectsSkipped++;
        break;
    }
  }

  const startedAt = events[0]?.timestamp ?? 0;
  const endedAt = events[events.length - 1]?.timestamp ?? startedAt;
  // Everything still open never terminated. Age it against the clock so the
  // report says how long it has been hanging, not zero.
  const asOf = now ?? endedAt;
  for (const span of open) {
    span.duration_ms = Math.max(0, asOf - span.startedAt);
    if (span.duration_ms >= HANG_THRESHOLD_MS) span.status = "hung";
  }

  // Spans were appended on `function.output`, so this array arrived in
  // COMPLETION order. Every consumer means "the tools it called, in order" —
  // and one of them, `expectFirstToolIn`, is only correct if that is true.
  // Sorting is safe for the rest: `tool_ms` is a sum, and the render and OTLP
  // paths carry their own timestamps.
  toolSpans.sort((a, b) => a.callSeq - b.callSeq);

  return {
    sessionId,
    startedAt,
    endedAt,
    wall_ms: Math.max(0, (now ?? endedAt) - startedAt),
    modelSpans,
    toolSpans,
    deniedSpans,
    model_ms: modelSpans.reduce((n, s) => n + s.duration_ms, 0),
    tool_ms: toolSpans.reduce((n, s) => n + s.duration_ms, 0),
    inputTokens: sum(modelSpans, "inputTokens"),
    outputTokens: sum(modelSpans, "outputTokens"),
    cacheReadTokens: sum(modelSpans, "cacheReadTokens"),
    // Only spans past the threshold count. An in-flight request is not a hang.
    hung: open.some((s) => s.status === "hung"),
    inFlight: open.some((s) => s.status === "in_flight"),
    redirects,
    redirectsSkipped,
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
