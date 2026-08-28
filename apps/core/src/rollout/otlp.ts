// =============================================================================
// OTLP export — a Trace as OpenTelemetry spans, for Langfuse / Phoenix /
// Jaeger / Tempo / any OTLP collector.
//
// Two deliberate constraints:
//
// 1. Exported from the LOG, not from the hot path. An exporter wired into the
//    agent loop is one more thing that can block, buffer, or throw inside the
//    request we are trying to make faster. The rollout log is already durable,
//    so shipping from it is strictly safer and loses nothing but immediacy.
//
// 2. No SDK dependency. OTLP/HTTP accepts plain JSON, so the whole exporter is
//    a fetch and a shape. Pulling in @opentelemetry/sdk-trace-node to emit a
//    document we can write by hand would be the larger cost.
//
// Attribute names follow the OpenTelemetry GenAI semantic conventions, which
// is what makes the spans render as LLM calls in those UIs rather than as
// anonymous blobs.
// =============================================================================

import { createHash } from "crypto";
import { PRICES_AS_OF, priceUsd, totalUsd } from "../providers/pricing.js";
import type { ModelSpan, Trace } from "./trace.js";

type AttrValue = string | number | boolean;
interface OtlpAttr {
  key: string;
  value: {
    stringValue?: string;
    intValue?: string;
    boolValue?: boolean;
    doubleValue?: number;
  };
}

/**
 * Attributes whose value is fractional and must NOT be rounded.
 *
 * Everything else here is a token count or a millisecond, where an integer is
 * both correct and smaller on the wire. These two are not: a cost is fractions
 * of a cent, so rounding reports every call as $0, and an evaluation score is
 * a rate in [0,1], so rounding turns a 50% pass rate into a perfect one. Both
 * failures are silent and both look like good news.
 */
const FRACTIONAL = new Set(["gen_ai.usage.cost", "gen_ai.evaluation.score.value"]);

export function attrs(record: Record<string, AttrValue | undefined>): OtlpAttr[] {
  const out: OtlpAttr[] = [];
  for (const [key, value] of Object.entries(record)) {
    if (value === undefined) continue;
    if (typeof value === "number" && FRACTIONAL.has(key)) {
      out.push({ key, value: { doubleValue: value } });
    } else if (typeof value === "number") {
      out.push({ key, value: { intValue: String(Math.round(value)) } });
    } else if (typeof value === "boolean") {
      out.push({ key, value: { boolValue: value } });
    } else {
      out.push({ key, value: { stringValue: value } });
    }
  }
  return out;
}

/** Deterministic ids, so re-exporting a session updates rather than duplicates it. */
export function hexId(seed: string, bytes: number): string {
  return createHash("sha256")
    .update(seed)
    .digest("hex")
    .slice(0, bytes * 2);
}

export const nano = (ms: number) => String(Math.round(ms) * 1_000_000);

// OTLP status codes: 0 unset, 1 ok, 2 error.
export const STATUS_ERROR = 2;
export const STATUS_OK = 1;

function modelSpanToOtlp(
  span: ModelSpan,
  traceId: string,
  parentSpanId: string,
  index: number,
  sessionId: string,
) {
  const failed = span.status !== "ok";
  return {
    traceId,
    spanId: hexId(`${traceId}:model:${index}`, 8),
    parentSpanId,
    name: `chat ${span.model}`,
    kind: 3, // CLIENT
    startTimeUnixNano: nano(span.startedAt),
    endTimeUnixNano: nano(span.startedAt + span.duration_ms),
    attributes: attrs({
      "gen_ai.operation.name": "chat",
      "gen_ai.system": span.provider,
      "gen_ai.request.model": span.model,
      "gen_ai.usage.input_tokens": span.inputTokens,
      "gen_ai.usage.output_tokens": span.outputTokens,
      "gen_ai.usage.cache_read_input_tokens": span.cacheReadTokens,
      "gen_ai.usage.cache_creation_input_tokens": span.cacheWriteTokens,
      "gen_ai.response.tool_calls": span.toolCalls.join(",") || undefined,
      // Ties every call in a session into one tree in Langfuse/Phoenix rather
      // than N unrelated chats (spec §12.3).
      "gen_ai.conversation.id": sessionId,
      // An estimate from a table with a vintage, not a bill — `pricing.ts`.
      // Absent, rather than 0, when the model is unpriced: a collector cannot
      // tell a real zero from a missing price, so it must not see one.
      "gen_ai.usage.cost": priceUsd(span.provider, span.model, span),
      // Not part of the convention, but the fields that actually explain a
      // slow or hung call — which is the whole point of exporting this.
      "freecode.turn_id": span.turnId,
      "freecode.status": span.status,
      "freecode.ttft_ms": span.ttft_ms,
      "freecode.prompt_chars": span.promptChars,
      "freecode.message_count": span.messageCount,
      "freecode.tool_count": span.toolCount,
      "freecode.error_kind": span.errorKind,
    }),
    status: failed
      ? {
          code: STATUS_ERROR,
          message:
            span.status === "hung"
              ? "request never terminated"
              : (span.error ?? "model error"),
        }
      : { code: STATUS_OK },
  };
}

/**
 * Session cost, or `undefined` when nothing in it could be priced. A partial
 * total is still emitted — most of a session priced is more useful than
 * silence — and `freecode.cost_partial` says so, so a dashboard summing these
 * can tell a complete figure from an incomplete one.
 */
function sessionCost(trace: Trace): number | undefined {
  return totalUsd(trace.modelSpans)?.usd;
}

/** Builds the OTLP `ExportTraceServiceRequest` body for a session. */
export function traceToOtlp(trace: Trace, serviceName = "freecode"): unknown {
  const traceId = hexId(trace.sessionId, 16);
  const rootSpanId = hexId(`${traceId}:root`, 8);

  const spans: unknown[] = [
    {
      traceId,
      spanId: rootSpanId,
      // `invoke_agent` rather than a bare name: the GenAI conventions cover
      // agent orchestration, and naming the root this way is what makes a
      // multi-turn session render as one agent run instead of N loose calls
      // (spec §12.3). Provisional — `gen_ai.*` agent attributes are still
      // marked Development, so they may be renamed.
      name: `invoke_agent freecode`,
      kind: 1, // INTERNAL
      startTimeUnixNano: nano(trace.startedAt),
      endTimeUnixNano: nano(trace.startedAt + trace.wall_ms),
      attributes: attrs({
        "gen_ai.operation.name": "invoke_agent",
        "gen_ai.agent.name": serviceName,
        "gen_ai.conversation.id": trace.sessionId,
        "session.id": trace.sessionId,
        "gen_ai.usage.input_tokens": trace.inputTokens,
        "gen_ai.usage.output_tokens": trace.outputTokens,
        "gen_ai.usage.cache_read_input_tokens": trace.cacheReadTokens,
        "gen_ai.usage.cost": sessionCost(trace),
        "freecode.cost_partial": totalUsd(trace.modelSpans)?.partial,
        "freecode.prices_as_of": PRICES_AS_OF,
        "freecode.model_ms": trace.model_ms,
        "freecode.tool_ms": trace.tool_ms,
        "freecode.hung": trace.hung,
        "freecode.in_flight": trace.inFlight,
      }),
      status: { code: trace.hung ? STATUS_ERROR : STATUS_OK },
    },
    ...trace.modelSpans.map((span, i) =>
      modelSpanToOtlp(span, traceId, rootSpanId, i, trace.sessionId),
    ),
    ...trace.toolSpans.map((span, i) => ({
      traceId,
      spanId: hexId(`${traceId}:tool:${i}`, 8),
      parentSpanId: rootSpanId,
      name: `execute_tool ${span.tool}`,
      kind: 1,
      startTimeUnixNano: nano(span.startedAt),
      endTimeUnixNano: nano(span.startedAt + span.duration_ms),
      attributes: attrs({
        "gen_ai.operation.name": "execute_tool",
        "gen_ai.tool.name": span.tool,
        "gen_ai.conversation.id": trace.sessionId,
      }),
      status: { code: STATUS_OK },
    })),
  ];

  return {
    resourceSpans: [
      {
        resource: { attributes: attrs({ "service.name": serviceName }) },
        scopeSpans: [{ scope: { name: "freecode.rollout" }, spans }],
      },
    ],
  };
}

export interface OtlpTarget {
  /** Collector base URL or full path; `/v1/traces` is appended if absent. */
  endpoint: string;
  /** e.g. `{ Authorization: "Basic ..." }` for Langfuse. */
  headers?: Record<string, string>;
}

/** Reads the standard OTEL_* environment variables, if the user set them. */
export function otlpTargetFromEnv(): OtlpTarget | undefined {
  const endpoint =
    process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT ??
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  if (!endpoint) return undefined;
  return { endpoint, headers: parseOtelHeaders() };
}

/** `OTEL_EXPORTER_OTLP_HEADERS` is a comma-separated `k=v` list, per spec. */
function parseOtelHeaders(): Record<string, string> | undefined {
  const raw = process.env.OTEL_EXPORTER_OTLP_HEADERS;
  if (!raw) return undefined;
  const headers: Record<string, string> = {};
  for (const pair of raw.split(",")) {
    const eq = pair.indexOf("=");
    if (eq <= 0) continue;
    headers[pair.slice(0, eq).trim()] = pair.slice(eq + 1).trim();
  }
  return Object.keys(headers).length > 0 ? headers : undefined;
}

/**
 * POSTs an already-built `ExportTraceServiceRequest`. Split out from
 * `exportTrace` so the eval harness can ship its own document (spec §12.4)
 * without either side re-deriving the URL rules or the error handling.
 */
export async function postOtlp(
  document: unknown,
  target: OtlpTarget,
): Promise<void> {
  const url = target.endpoint.includes("/v1/traces")
    ? target.endpoint
    : `${target.endpoint.replace(/\/$/, "")}/v1/traces`;

  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...target.headers },
    body: JSON.stringify(document),
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    throw new Error(
      `OTLP export to ${url} failed: ${response.status} ${await response.text().catch(() => "")}`,
    );
  }
}

export async function exportTrace(
  trace: Trace,
  target: OtlpTarget,
): Promise<void> {
  return postOtlp(traceToOtlp(trace), target);
}
