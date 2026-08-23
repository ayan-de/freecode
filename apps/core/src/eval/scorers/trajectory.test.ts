import test from "node:test";
import assert from "node:assert/strict";
import { scoreTrajectory } from "./trajectory.js";
import type { Trace, ToolSpan, ModelSpan } from "../../rollout/trace.js";
import type { EvalCase, RunRecord } from "../types.js";

function tool(name: string, args?: Record<string, unknown>): ToolSpan {
  return { tool: name, startedAt: 0, duration_ms: 10, ...(args ? { args } : {}) };
}

function modelSpan(status: ModelSpan["status"] = "ok"): ModelSpan {
  return {
    turnId: "turn-0",
    provider: "anthropic",
    model: "m",
    startedAt: 0,
    status,
    duration_ms: 100,
    messageCount: 1,
    toolCount: 1,
    promptChars: 10,
    toolCalls: [],
  };
}

function run(toolSpans: ToolSpan[], modelSpans = [modelSpan()]): RunRecord {
  const trace: Trace = {
    sessionId: "s1",
    startedAt: 0,
    endedAt: 100,
    wall_ms: 100,
    modelSpans,
    toolSpans,
    model_ms: 100,
    tool_ms: 10,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    hung: false,
    inFlight: false,
  };
  return { trace, prompt: "p", response: "r" };
}

const kase = (over: Partial<EvalCase>): EvalCase => ({ id: "c", prompt: "p", ...over });

test("passes when the expected tool fired", () => {
  const score = scoreTrajectory(run([tool("grep")]), kase({ expectTool: "grep" }));
  assert.equal(score.passed, true);
});

test("names what was called instead when the expected tool is missing", () => {
  const score = scoreTrajectory(run([tool("read")]), kase({ expectTool: "grep" }));
  assert.equal(score.passed, false);
  assert.match(score.reason, /expected grep, called read/);
});

test("expectTool null asserts that nothing fired", () => {
  assert.equal(scoreTrajectory(run([]), kase({ expectTool: null })).passed, true);
  const score = scoreTrajectory(run([tool("ls")]), kase({ expectTool: null }));
  assert.equal(score.passed, false);
});

test("matches args from the span the Phase 0 fold now carries", () => {
  const score = scoreTrajectory(
    run([tool("grep", { pattern: "HANG_THRESHOLD_MS" })]),
    kase({ expectTool: "grep", expectInArgs: { pattern: "HANG_THRESHOLD" } }),
  );
  assert.equal(score.passed, true);
});

test("any invocation of the tool may satisfy the argument expectation", () => {
  // A model that greps twice, badly then well, has still done the right thing.
  const score = scoreTrajectory(
    run([tool("grep", { pattern: "wrong" }), tool("grep", { pattern: "right" })]),
    kase({ expectTool: "grep", expectInArgs: { pattern: "right" } }),
  );
  assert.equal(score.passed, true);
});

test("reports missing args rather than silently passing", () => {
  const score = scoreTrajectory(
    run([tool("grep")]),
    kase({ expectTool: "grep", expectInArgs: { pattern: "x" } }),
  );
  assert.equal(score.passed, false);
  assert.match(score.reason, /no recorded args/);
});

test("a forbidden tool fails even when the expected one also fired", () => {
  const score = scoreTrajectory(
    run([tool("grep"), tool("write")]),
    kase({ expectTool: "grep", forbidTools: ["write"] }),
  );
  assert.equal(score.passed, false);
  assert.match(score.reason, /forbidden write/);
});

test("exceeding the turn budget fails", () => {
  const score = scoreTrajectory(
    run([tool("grep")], [modelSpan(), modelSpan(), modelSpan()]),
    kase({ expectTool: "grep", expectMaxTurns: 2 }),
  );
  assert.equal(score.passed, false);
  assert.match(score.reason, /3 turns/);
});

test("a hung or errored model call is never a pass", () => {
  // Otherwise a case goes green off a trajectory that never finished.
  const hung = run([tool("grep")]);
  hung.trace.hung = true;
  assert.equal(scoreTrajectory(hung, kase({ expectTool: "grep" })).passed, false);

  const errored = run([tool("grep")], [modelSpan("error")]);
  const score = scoreTrajectory(errored, kase({ expectTool: "grep" }));
  assert.equal(score.passed, false);
  assert.match(score.reason, /model error/);
});
