// =============================================================================
// Trace rendering — a Trace as a terminal waterfall.
//
// Optimised for one question: where did the time go? So every line leads with
// a duration, model calls are never collapsed, and anything that hung or
// errored is called out rather than left for the reader to spot.
// =============================================================================

import { HANG_THRESHOLD_MS, type ModelSpan, type Trace } from "./trace.js";

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return `${minutes}m${String(seconds).padStart(2, "0")}s`;
}

function count(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}

function clock(ts: number): string {
  return new Date(ts).toTimeString().slice(0, 8);
}

/** Durations above this get coloured; slow model calls should not be scannable-past. */
const SLOW_MS = 30_000;

function durationTag(ms: number, status: ModelSpan["status"]): string {
  const text = formatDuration(ms).padStart(7);
  if (status === "hung") return red(text);
  if (status === "error") return yellow(text);
  if (status === "in_flight") return cyan(text);
  return ms >= SLOW_MS ? yellow(text) : dim(text);
}

function renderModelSpan(span: ModelSpan): string[] {
  const lines: string[] = [];
  const head =
    `${dim(clock(span.startedAt))} ${durationTag(span.duration_ms, span.status)} ` +
    `${cyan("model")} ${span.turnId}`;
  lines.push(head);

  const facts = [
    `msgs=${span.messageCount}`,
    `prompt=${count(span.promptChars)}c`,
    span.ttft_ms !== undefined ? `ttft=${formatDuration(span.ttft_ms)}` : "",
    span.inputTokens !== undefined ? `in=${count(span.inputTokens)}` : "",
    span.outputTokens !== undefined ? `out=${count(span.outputTokens)}` : "",
    span.cacheReadTokens ? `cached=${count(span.cacheReadTokens)}` : "",
  ].filter(Boolean);
  lines.push(`                  ${dim(facts.join("  "))}`);

  if (span.toolCalls.length > 0) {
    lines.push(`                  ${dim("→ " + span.toolCalls.join(", "))}`);
  }
  if (span.status === "in_flight") {
    // Not a fault. Saying otherwise trained the reader to ignore the word.
    lines.push(
      `                  ${cyan("in flight")} ${dim(
        span.ttft_ms === undefined ? "— awaiting first token" : "— streaming",
      )}`,
    );
  }
  if (span.status === "hung") {
    lines.push(
      `                  ${red("HUNG")} ${dim(`— open for over ${formatDuration(HANG_THRESHOLD_MS)} with no response and no error.`)}`,
    );
    if (span.ttft_ms === undefined) {
      lines.push(
        `                  ${dim("Never produced a first token: the provider accepted the connection and went silent.")}`,
      );
    }
  }
  if (span.status === "error") {
    lines.push(
      `                  ${yellow(span.errorKind ?? "error")}: ${span.error ?? ""}`,
    );
  }
  return lines;
}

export interface RenderOptions {
  /** Hide model calls faster than this, and all tool calls. */
  slowerThanMs?: number;
  /** Include the per-tool waterfall rows. */
  showTools?: boolean;
}

export function renderTrace(trace: Trace, opts: RenderOptions = {}): string {
  const threshold = opts.slowerThanMs ?? 0;
  const out: string[] = [];

  const first = trace.modelSpans[0];
  out.push(
    bold(`session ${trace.sessionId.slice(0, 8)}`) +
      (first ? dim(`  ${first.provider}/${first.model}`) : "") +
      dim(`  ${formatDuration(trace.wall_ms)} wall`),
  );
  out.push("");

  const rows: Array<{ at: number; lines: string[] }> = [];
  for (const span of trace.modelSpans) {
    if (span.duration_ms < threshold) continue;
    rows.push({ at: span.startedAt, lines: renderModelSpan(span) });
  }
  if (opts.showTools && threshold === 0) {
    for (const span of trace.toolSpans) {
      rows.push({
        at: span.startedAt,
        lines: [
          `${dim(clock(span.startedAt))} ${dim(formatDuration(span.duration_ms).padStart(7))} ` +
            `${dim("tool ")} ${span.tool}`,
        ],
      });
    }
  }
  rows.sort((a, b) => a.at - b.at);
  for (const row of rows) out.push(...row.lines);

  out.push("");
  out.push(bold("where the time went"));
  const other = Math.max(0, trace.wall_ms - trace.model_ms - trace.tool_ms);
  out.push(
    `  model   ${formatDuration(trace.model_ms).padStart(8)}  ${pct(trace.model_ms, trace.wall_ms)}  ${dim(`${trace.modelSpans.length} calls`)}`,
  );
  out.push(
    `  tools   ${formatDuration(trace.tool_ms).padStart(8)}  ${pct(trace.tool_ms, trace.wall_ms)}  ${dim(`${trace.toolSpans.length} calls`)}`,
  );
  out.push(
    `  other   ${formatDuration(other).padStart(8)}  ${pct(other, trace.wall_ms)}  ${dim("user input, idle")}`,
  );
  out.push(
    dim(
      `  tokens  in=${count(trace.inputTokens)} out=${count(trace.outputTokens)} cached=${count(trace.cacheReadTokens)}`,
    ),
  );
  // Only when something happened: a line reading "redirects 0" on every
  // healthy session is noise, and the feature is off by default.
  if (trace.redirects > 0 || trace.redirectsSkipped > 0) {
    out.push(
      dim(
        `  redirect  fired=${trace.redirects} skipped=${trace.redirectsSkipped}`,
      ),
    );
  }

  const hung = trace.modelSpans.filter((s) => s.status === "hung");
  const errored = trace.modelSpans.filter((s) => s.status === "error");
  out.push("");
  if (trace.modelSpans.length === 0) {
    // Silence here means "nothing was recorded", not "nothing went wrong".
    // Saying "no hangs" over a log with no model events would be a lie.
    out.push(
      yellow("no model calls recorded") +
        dim(
          " — this log predates model tracing, so the gaps above are unattributed.",
        ),
    );
  } else if (hung.length > 0) {
    out.push(
      red(
        `${hung.length} request(s) open for over ${formatDuration(HANG_THRESHOLD_MS)}`,
      ) + dim(" — hung on the provider, not on a tool."),
    );
  } else if (errored.length > 0) {
    out.push(yellow(`${errored.length} model call(s) failed`));
  } else if (trace.inFlight) {
    out.push(
      cyan("a request is in flight") +
        dim(" — not a fault; still within budget."),
    );
  } else {
    out.push(green("no hangs, no model errors"));
  }
  return out.join("\n");
}

function pct(part: number, whole: number): string {
  if (whole <= 0) return dim("  0%");
  return dim(`${String(Math.round((part / whole) * 100)).padStart(3)}%`);
}
