import test from "node:test";
import assert from "node:assert/strict";
import { echoDisagreements, echoedModels } from "./model-echo.js";
import type { ModelSpan, Trace } from "../rollout/trace.js";

function span(model: string, echoedModel?: string): ModelSpan {
  return {
    turnId: "t",
    provider: "anthropic",
    model,
    ...(echoedModel ? { echoedModel } : {}),
    startedAt: 0,
    status: "ok",
    duration_ms: 1,
    messageCount: 1,
    toolCount: 0,
    promptChars: 1,
    toolCalls: [],
  };
}

const trace = (modelSpans: ModelSpan[]): Trace =>
  ({ modelSpans }) as unknown as Trace;

test("collects distinct echoed ids, sorted", () => {
  const t = trace([
    span("m", "b-2"),
    span("m", "a-1"),
    span("m", "b-2"),
    span("m"),
  ]);
  assert.deepEqual(echoedModels(t), ["a-1", "b-2"]);
});

test("a provider that echoes nothing yields nothing, not agreement", () => {
  // Absent must stay distinguishable from "matched" — the whole point is that
  // silence is not evidence.
  assert.deepEqual(echoedModels(trace([span("m")])), []);
});

test("a dated snapshot of the requested alias is not a disagreement", () => {
  // Every provider we support resolves an alias server-side. Flagging this
  // would make the line noise on run one and ignored by run two.
  assert.deepEqual(
    echoDisagreements("anthropic/claude-sonnet-4-6", [
      "claude-sonnet-4-6-20260101",
    ]),
    [],
  );
});

test("the routing prefix is ours, not the provider's", () => {
  assert.deepEqual(
    echoDisagreements("minimax/MiniMax-M3", ["MiniMax-M3"]),
    [],
  );
});

test("matching is case-insensitive", () => {
  assert.deepEqual(echoDisagreements("openai/GPT-5", ["gpt-5-2026-01-01"]), []);
});

test("an echo that is not the requested model at all is reported", () => {
  const odd = echoDisagreements("anthropic/claude-sonnet-4-6", [
    "claude-sonnet-4-6-20260101",
    "claude-haiku-4-5",
  ]);
  assert.deepEqual(odd, ["claude-haiku-4-5"]);
});

test("no requested model means nothing to disagree with", () => {
  // History written before the model was recorded. Reporting every echo as a
  // disagreement there would be worse than saying nothing.
  assert.deepEqual(echoDisagreements(undefined, ["anything"]), []);
});
