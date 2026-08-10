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
import type { ModelSpan, Trace } from "./trace.js";

type AttrValue = string | number | boolean;
interface OtlpAttr {
  key: string;
  value: { stringValue?: string; intValue?: string; boolValue?: boolean };
}

function attrs(record: Record<string, AttrValue | undefined>): OtlpAttr[] {
  const out: OtlpAttr[] = [];
  for (const [key, value] of Object.entries(record)) {
    if (value === undefined) continue;
    if (typeof value === "number") {
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
function hexId(seed: string, bytes: number): string {
  return createHash("sha256")
    .update(seed)
    .digest("hex")
    .slice(0, bytes * 2);
}

const nano = (ms: number) => String(Math.round(ms) * 1_000_000);

// OTLP status codes: 0 unset, 1 ok, 2 error.
const STATUS_ERROR = 2;
const STATUS_OK = 1;

function modelSpanToOtlp(
  span: ModelSpan,
  traceId: string,
  parentSpanId: string,
  index: number,
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
      "gen_ai.response.tool_calls": span.toolCalls.join(",") || undefined,
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

/** Builds the OTLP `ExportTraceServiceRequest` body for a session. */
export function traceToOtlp(trace: Trace, serviceName = "freecode"): unknown {
  const traceId = hexId(trace.sessionId, 16);
  const rootSpanId = hexId(`${traceId}:root`, 8);

  const spans: unknown[] = [
    {
      traceId,
      spanId: rootSpanId,
      name: `session ${trace.sessionId.slice(0, 8)}`,
      kind: 1, // INTERNAL
      startTimeUnixNano: nano(trace.startedAt),
      endTimeUnixNano: nano(trace.startedAt + trace.wall_ms),
      attributes: attrs({
        "session.id": trace.sessionId,
        "freecode.model_ms": trace.model_ms,
        "freecode.tool_ms": trace.tool_ms,
        "freecode.hung": trace.hung,
        "freecode.in_flight": trace.inFlight,
      }),
      status: { code: trace.hung ? STATUS_ERROR : STATUS_OK },
    },
    ...trace.modelSpans.map((span, i) =>
      modelSpanToOtlp(span, traceId, rootSpanId, i),
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

export async function exportTrace(
  trace: Trace,
  target: OtlpTarget,
): Promise<void> {
  const url = target.endpoint.includes("/v1/traces")
    ? target.endpoint
    : `${target.endpoint.replace(/\/$/, "")}/v1/traces`;

  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...target.headers },
    body: JSON.stringify(traceToOtlp(trace)),
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    throw new Error(
      `OTLP export to ${url} failed: ${response.status} ${await response.text().catch(() => "")}`,
    );
  }
}
