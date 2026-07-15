import test from "node:test";
import assert from "node:assert/strict";
import { busEventToClientEvent } from "./bridge.js";

test("question.asked maps to a question_asked stream event", () => {
  const out = busEventToClientEvent({
    type: "question.asked",
    requestId: "r1",
    sessionId: "s1",
    questions: [
      { question: "Pick", options: [{ label: "A", description: "a" }] },
    ],
  } as any);
  assert.equal(out?.type, "question_asked");
  assert.equal((out as any).requestId, "r1");
  assert.equal((out as any).questions.length, 1);
});

test("internal cache-invalidation events are dropped (return undefined)", () => {
  assert.equal(
    busEventToClientEvent({
      type: "tools.changed",
      added: [],
      removed: [],
    } as any),
    undefined,
  );
  assert.equal(
    busEventToClientEvent({ type: "mcp.tools.changed", server: "x" } as any),
    undefined,
  );
});

test("a forwarded lifecycle event keeps its type and payload", () => {
  const out = busEventToClientEvent({
    type: "subagent.started",
    subagentId: "a",
    subagentType: "explore",
    parentId: "p",
    task: "t",
  } as any);
  assert.equal(out?.type, "subagent.started");
});

test("a stream relay event is unwrapped to its inner StreamEvent", () => {
  const inner = { type: "text_delta", delta: "hi" } as const;
  const out = busEventToClientEvent({
    type: "stream",
    sessionId: "s1",
    event: inner,
  } as any);
  assert.deepEqual(out, inner);
});

test("redundant bus tool.called/tool.completed are dropped", () => {
  assert.equal(busEventToClientEvent({ type: "tool.called" } as any), undefined);
  assert.equal(
    busEventToClientEvent({ type: "tool.completed" } as any),
    undefined,
  );
});
