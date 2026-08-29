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

test("a denied call is recorded, and is not counted as a tool that ran", () => {
  // The bug this fixes: `loop.ts` returns on a permission deny BEFORE
  // recordFunctionCall, so the attempt left no event at all and a model
  // burning turns against a mode it cannot satisfy folded to an empty trace.
  const trace = buildTrace("s1", [
    event("function.denied", 500, {
      turnId: "turn-0",
      tool: "edit",
      args: { filePath: "apps/core/src/eval/match.ts" },
      source: "mode",
      reason: 'Tool "edit" is not allowed in review mode (read-only)',
    }),
  ]);
  assert.equal(trace.deniedSpans.length, 1);
  assert.equal(trace.deniedSpans[0].tool, "edit");
  assert.equal(trace.deniedSpans[0].source, "mode");
  assert.match(trace.deniedSpans[0].reason, /review mode/);
  assert.deepEqual(trace.deniedSpans[0].args, {
    filePath: "apps/core/src/eval/match.ts",
  });
  // The whole point of the separate array: nothing that reads `toolSpans` as
  // "tools that ran" starts seeing a mutation that never happened.
  assert.equal(trace.toolSpans.length, 0);
  assert.equal(trace.tool_ms, 0);
});

test("denied calls do not consume the pairing state of a real call", () => {
  const trace = buildTrace("s1", [
    event("function.call", 100, { turnId: "turn-0", tool: "bash", args: {} }),
    event("function.denied", 150, {
      turnId: "turn-0",
      tool: "bash",
      args: { command: "rm -rf /" },
      source: "rule",
      reason: "Permission denied by rule: bash(rm:*)",
    }),
    event("function.output", 300, {
      turnId: "turn-0",
      tool: "bash",
      output: "ok",
      duration_ms: 200,
    }),
  ]);
  assert.equal(trace.toolSpans.length, 1);
  assert.equal(trace.toolSpans[0].startedAt, 100);
  assert.equal(trace.deniedSpans.length, 1);
});

test("a log written before function.denied existed folds to no denials", () => {
  const trace = buildTrace("s1", [request(1000), response(2000, 1000)]);
  assert.deepEqual(trace.deniedSpans, []);
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

test("the rendered trace names refused calls and counts them", () => {
  const events = [
    request(1000),
    response(2000, 1000),
    event("function.denied", 1500, {
      turnId: "turn-0",
      tool: "bash",
      args: { command: "node -e 'x'" },
      source: "mode",
      reason: "Permission denied (mode-default)",
    }),
  ];
  const text = renderTrace(buildTrace("s1", events), { showTools: true });
  assert.match(text, /deny/, "the timeline shows the refusal");
  assert.match(text, /bash/);
  assert.match(text, /mode-default/, "and says which gate refused it");
  assert.match(text, /1 denied/, "the summary counts it separately");
});

test("a trace with no denials says nothing about them", () => {
  const text = renderTrace(buildTrace("s1", [request(1000), response(2000, 1000)]), {
    showTools: true,
  });
  assert.ok(!/denied/.test(text));
});

test("keeps the served model id off model.response", () => {
  // `model.request` records what we asked for and `model.response` what was
  // served; the fold used to drop the second, so a stable alias answered by a
  // rolled snapshot left no trace of the roll anywhere we keep.
  const served = {
    ...response(4000, 3000),
    echoedModel: "MiniMax-M3-20260215",
  } as RolloutEvent;
  const trace = buildTrace("s1", [request(1000), served]);
  assert.equal(trace.modelSpans[0].model, "MiniMax-M3");
  assert.equal(trace.modelSpans[0].echoedModel, "MiniMax-M3-20260215");
});

test("a response with no served model leaves the span's echo undefined", () => {
  const trace = buildTrace("s1", [request(1000), response(4000, 3000)]);
  assert.equal(trace.modelSpans[0].echoedModel, undefined);
});

test("an errored call carries no served model", () => {
  // model.error has no echo to record, and defaulting it to the requested id
  // would manufacture agreement out of a call that never completed.
  const trace = buildTrace("s1", [
    request(1000),
    event("model.error", 2000, {
      turnId: "turn-0",
      provider: "minimax",
      model: "MiniMax-M3",
      duration_ms: 1000,
      kind: "provider",
      error: "boom",
    }),
  ]);
  assert.equal(trace.modelSpans[0].status, "error");
  assert.equal(trace.modelSpans[0].echoedModel, undefined);
});

test("a parallel batch is ordered by CALL, not by which finished first", () => {
  // The blocker this fixes: spans are appended on `function.output`, and
  // `Promise.all` in loop.ts lets a later call finish first. `expectFirstToolIn`
  // then scored the fast tool as the opening move.
  const trace = buildTrace("s1", [
    event("function.call", 1000, { turnId: "t", tool: "grep", args: {}, callId: "c1" }),
    event("function.call", 1001, { turnId: "t", tool: "read", args: {}, callId: "c2" }),
    // `read` finishes first.
    event("function.output", 1100, {
      turnId: "t", tool: "read", output: "", duration_ms: 99, callId: "c2",
    }),
    event("function.output", 1500, {
      turnId: "t", tool: "grep", output: "", duration_ms: 500, callId: "c1",
    }),
  ]);
  assert.deepEqual(
    trace.toolSpans.map((s) => s.tool),
    ["grep", "read"],
  );
});

test("concurrent calls to the SAME tool keep their own arguments", () => {
  // Pairing used to be keyed by tool name, so the second call overwrote the
  // first's pending entry and both outputs read the surviving args.
  const trace = buildTrace("s1", [
    event("function.call", 1000, {
      turnId: "t", tool: "read", args: { filePath: "first.ts" }, callId: "a",
    }),
    event("function.call", 1001, {
      turnId: "t", tool: "read", args: { filePath: "second.ts" }, callId: "b",
    }),
    event("function.output", 1100, {
      turnId: "t", tool: "read", output: "", duration_ms: 5, callId: "b",
    }),
    event("function.output", 1200, {
      turnId: "t", tool: "read", output: "", duration_ms: 9, callId: "a",
    }),
  ]);
  assert.deepEqual(
    trace.toolSpans.map((s) => s.args?.filePath),
    ["first.ts", "second.ts"],
  );
});

test("a log with no callId still yields ascending call order", () => {
  // Logs written before callId existed. Oldest pending call of that tool wins,
  // so the ORDER is right even though two same-tool calls cannot be told apart.
  const trace = buildTrace("s1", [
    event("function.call", 1000, { turnId: "t", tool: "grep", args: {} }),
    event("function.call", 1001, { turnId: "t", tool: "read", args: {} }),
    event("function.output", 1100, {
      turnId: "t", tool: "read", output: "", duration_ms: 5,
    }),
    event("function.output", 1500, {
      turnId: "t", tool: "grep", output: "", duration_ms: 400,
    }),
  ]);
  assert.deepEqual(trace.toolSpans.map((s) => s.tool), ["grep", "read"]);
});

test("an output whose opening call was lost is still ordered sanely", () => {
  const trace = buildTrace("s1", [
    event("function.call", 1000, { turnId: "t", tool: "grep", args: {}, callId: "c1" }),
    event("function.output", 1100, {
      turnId: "t", tool: "grep", output: "", duration_ms: 5, callId: "c1",
    }),
    // No matching call — truncated log, or resumed mid-turn.
    event("function.output", 1200, {
      turnId: "t", tool: "write", output: "", duration_ms: 5, callId: "gone",
    }),
  ]);
  assert.deepEqual(trace.toolSpans.map((s) => s.tool), ["grep", "write"]);
});
