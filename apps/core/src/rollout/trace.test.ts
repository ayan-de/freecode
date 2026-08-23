import test from "node:test";
import assert from "node:assert/strict";
import { HANG_THRESHOLD_MS, buildTrace } from "./trace.js";
import { renderTrace } from "./trace-render.js";
import type { RolloutEvent } from "./types.js";

let seq = 0;
function event(
  type: RolloutEvent["type"],
  timestamp: number,
  fields: Record<string, unknown>,
): RolloutEvent {
  seq++;
  return {
    type,
    id: `id-${seq}`,
    seq,
    aggregateID: "s1",
    timestamp,
    ...fields,
  } as RolloutEvent;
}

function request(ts: number, turnId = "turn-0"): RolloutEvent {
  return event("model.request", ts, {
    turnId,
    provider: "minimax",
    model: "MiniMax-M3",
    messageCount: 10,
    toolCount: 15,
    promptChars: 48_000,
    streamed: true,
  });
}

function response(ts: number, duration_ms: number, turnId = "turn-0") {
  return event("model.response", ts, {
    turnId,
    provider: "minimax",
    model: "MiniMax-M3",
    duration_ms,
    ttft_ms: 500,
    inputTokens: 12_000,
    outputTokens: 200,
    cacheReadTokens: 11_000,
    toolCalls: ["bash"],
    textChars: 40,
    thinkingChars: 0,
  });
}

test("pairs a request with its response", () => {
  const trace = buildTrace("s1", [request(1000), response(4000, 3000)]);
  assert.equal(trace.modelSpans.length, 1);
  assert.equal(trace.modelSpans[0].status, "ok");
  assert.equal(trace.modelSpans[0].duration_ms, 3000);
  assert.equal(trace.modelSpans[0].ttft_ms, 500);
  assert.equal(trace.hung, false);
  assert.equal(trace.inputTokens, 12_000);
});

test("an unterminated request is a hang, aged against the clock", () => {
  // The bug this whole subsystem exists for: a request goes out, nothing ever
  // comes back, and the log simply stops.
  const trace = buildTrace("s1", [request(1000)], 901_000);
  assert.equal(trace.hung, true);
  assert.equal(trace.modelSpans[0].status, "hung");
  assert.equal(trace.modelSpans[0].duration_ms, 900_000);
  assert.equal(trace.modelSpans[0].ttft_ms, undefined);
});

test("a hang after first token is distinguishable from one before", () => {
  const trace = buildTrace(
    "s1",
    [
      request(1000),
      event("model.first_token", 1600, { turnId: "turn-0", ttft_ms: 600 }),
    ],
    1000 + HANG_THRESHOLD_MS + 1,
  );
  assert.equal(trace.modelSpans[0].status, "hung");
  assert.equal(trace.modelSpans[0].ttft_ms, 600);
});

test("an in-flight request is not a hang", () => {
  // The false positive: every live request rendered as HUNG the moment
  // --follow drew it, then "recovered" when the response landed.
  const trace = buildTrace("s1", [request(1000)], 1000 + 2_000);
  assert.equal(trace.modelSpans[0].status, "in_flight");
  assert.equal(trace.hung, false);
  assert.equal(trace.inFlight, true);
});

test("in flight becomes hung only past the threshold", () => {
  const justUnder = buildTrace("s1", [request(0)], HANG_THRESHOLD_MS - 1);
  assert.equal(justUnder.modelSpans[0].status, "in_flight");

  const justOver = buildTrace("s1", [request(0)], HANG_THRESHOLD_MS + 1);
  assert.equal(justOver.modelSpans[0].status, "hung");
  assert.equal(justOver.hung, true);
});

test("renders an in-flight request without crying wolf", () => {
  const text = renderTrace(buildTrace("s1", [request(1000)], 3000));
  assert.doesNotMatch(text, /HUNG/);
  assert.match(text, /in flight/);
});

test("records a stall as an error with its kind", () => {
  const trace = buildTrace("s1", [
    request(1000),
    event("model.error", 121_000, {
      turnId: "turn-0",
      provider: "minimax",
      model: "MiniMax-M3",
      duration_ms: 120_000,
      kind: "stall",
      error: "Provider sent no response for 120s",
    }),
  ]);
  assert.equal(trace.modelSpans[0].status, "error");
  assert.equal(trace.modelSpans[0].errorKind, "stall");
  assert.equal(trace.hung, false);
});

test("attributes time across model, tools and idle", () => {
  const trace = buildTrace("s1", [
    request(0),
    response(10_000, 10_000),
    event("function.call", 10_100, {
      turnId: "turn-0",
      tool: "bash",
      args: {},
    }),
    event("function.output", 10_600, {
      turnId: "turn-0",
      tool: "bash",
      output: "ok",
      duration_ms: 500,
    }),
  ]);
  assert.equal(trace.model_ms, 10_000);
  assert.equal(trace.tool_ms, 500);
  assert.equal(trace.toolSpans.length, 1);
  assert.equal(trace.wall_ms, 10_600);
});

test("carries tool call arguments from the call onto the span", () => {
  // `function.output` has no args of its own — they only exist on the paired
  // `function.call`, and the fold used to drop them. Trajectory scoring
  // (expect_in_args) reads them off the span.
  const trace = buildTrace("s1", [
    event("function.call", 100, {
      turnId: "turn-0",
      tool: "grep",
      args: { pattern: "HANG_THRESHOLD_MS", path: "apps/core" },
    }),
    event("function.output", 300, {
      turnId: "turn-0",
      tool: "grep",
      output: "trace.ts:26",
      duration_ms: 200,
    }),
  ]);
  assert.deepEqual(trace.toolSpans[0].args, {
    pattern: "HANG_THRESHOLD_MS",
    path: "apps/core",
  });
});

test("leaves args undefined when the opening call was never logged", () => {
  // A truncated log or a session resumed mid-turn can produce an output whose
  // call is absent. That must degrade to "no args", not crash the fold.
  const trace = buildTrace("s1", [
    event("function.output", 300, {
      turnId: "turn-0",
      tool: "grep",
      output: "x",
      duration_ms: 200,
    }),
  ]);
  assert.equal(trace.toolSpans[0].args, undefined);
  assert.equal(trace.toolSpans[0].startedAt, 300);
});

test("a response after a turnId reset still closes the open request", () => {
  // Resuming a session restarts turn numbering; matching purely on turnId
  // would orphan the response and invent a hang that did not happen.
  const trace = buildTrace("s1", [
    request(0, "turn-7"),
    response(2000, 2000, "turn-0"),
  ]);
  assert.equal(trace.hung, false);
  assert.equal(trace.modelSpans[0].status, "ok");
});

test("renders a hang without claiming the session was healthy", () => {
  const text = renderTrace(buildTrace("s1", [request(1000)], 901_000));
  assert.match(text, /HUNG/);
  assert.match(text, /open for over/);
  assert.doesNotMatch(text, /no hangs/);
});

test("says so when a log has no model events at all", () => {
  const trace = buildTrace("s1", [
    event("turn.started", 0, { turnId: "turn-0" }),
  ]);
  const text = renderTrace(trace);
  assert.match(text, /no model calls recorded/);
  assert.doesNotMatch(text, /no hangs/);
});
