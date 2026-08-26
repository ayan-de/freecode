import test from "node:test";
import assert from "node:assert/strict";
import { caseId, formatCase, harvestCase, HarvestError, shortenPath } from "./harvest.js";
import type { RolloutEvent } from "../rollout/types.js";
import type { SerializedMessage } from "../session/store.js";

let seq = 0;
const base = (timestamp: number) => ({
  id: `e${seq}`,
  seq: seq++,
  aggregateID: "s1",
  timestamp,
});

const modelRequest = (t: number, turnId = "turn-0"): RolloutEvent => ({
  ...base(t),
  type: "model.request",
  turnId,
  provider: "anthropic",
  model: "claude-sonnet-5",
  messageCount: 1,
  toolCount: 5,
  promptChars: 100,
  streamed: true,
});

const modelResponse = (t: number, turnId = "turn-0"): RolloutEvent => ({
  ...base(t),
  type: "model.response",
  turnId,
  provider: "anthropic",
  model: "claude-sonnet-5",
  duration_ms: 50,
  toolCalls: [],
  textChars: 10,
  thinkingChars: 0,
});

const call = (
  t: number,
  tool: string,
  args: Record<string, unknown>,
): RolloutEvent => ({
  ...base(t),
  type: "function.call",
  turnId: "turn-0",
  tool,
  args,
  seq: 0,
});

const output = (t: number, tool: string): RolloutEvent => ({
  ...base(t),
  type: "function.output",
  turnId: "turn-0",
  tool,
  output: "ok",
  duration_ms: 5,
});

const userMsg = (t: number, content: string): SerializedMessage => ({
  id: `m${t}`,
  role: "user",
  parts: [{ type: "text", content }],
  timestamp: t,
});

const assistantMsg = (t: number): SerializedMessage => ({
  id: `a${t}`,
  role: "assistant",
  parts: [{ type: "text", content: "done" }],
  timestamp: t,
});

test("harvests the last user turn by default", () => {
  const result = harvestCase({
    sessionId: "abcdef123456",
    messages: [
      userMsg(100, "first question"),
      assistantMsg(150),
      userMsg(200, "second question"),
    ],
    events: [
      modelRequest(110),
      call(120, "read", { filePath: "a.ts" }),
      output(125, "read"),
      modelResponse(130),
      modelRequest(210),
      call(220, "grep", { pattern: "HANG_THRESHOLD" }),
      output(225, "grep"),
      modelResponse(230),
    ],
  });

  assert.equal(result.turn, 2);
  assert.equal(result.turnCount, 2);
  assert.equal(result.kase.prompt, "second question");
  // Scoped by timestamp: turn 1's `read` must not leak into turn 2.
  assert.equal(result.kase.expectTool, "grep");
  assert.deepEqual(result.kase.expectInArgs, { pattern: "HANG_THRESHOLD" });
  assert.equal(result.kase.expectMaxTurns, 1);
});

test("--turn selects an earlier turn, scoped to its own window", () => {
  const result = harvestCase({
    sessionId: "abcdef123456",
    messages: [
      userMsg(100, "first question"),
      userMsg(200, "second question"),
    ],
    events: [
      modelRequest(110),
      call(120, "read", { filePath: "a.ts" }),
      output(125, "read"),
      modelResponse(130),
      modelRequest(210),
      call(220, "grep", { pattern: "x" }),
      output(225, "grep"),
      modelResponse(230),
    ],
    turn: 1,
  });
  assert.equal(result.kase.prompt, "first question");
  assert.equal(result.kase.expectTool, "read");
});

test("a session with no user prompt fails loudly", () => {
  // Spec §8: better to fail than emit a case with an empty task.
  assert.throws(
    () =>
      harvestCase({
        sessionId: "abcdef123456",
        messages: [assistantMsg(100)],
        events: [modelRequest(110)],
      }),
    (e: Error) => e instanceof HarvestError && /no recorded user prompt/.test(e.message),
  );
});

test("an out-of-range turn names the range", () => {
  assert.throws(
    () =>
      harvestCase({
        sessionId: "abcdef123456",
        messages: [userMsg(100, "q")],
        events: [modelRequest(110)],
        turn: 4,
      }),
    (e: Error) => e instanceof HarvestError && /session has 1 user turn/.test(e.message),
  );
});

test("a turn with no rollout events fails rather than emitting an empty trajectory", () => {
  assert.throws(
    () =>
      harvestCase({
        sessionId: "abcdef123456",
        messages: [userMsg(100, "q"), userMsg(200, "q2")],
        events: [modelRequest(110), modelResponse(130)],
        turn: 2,
      }),
    (e: Error) => e instanceof HarvestError && /no rollout events recorded for turn 2/.test(e.message),
  );
});

test("a turn where nothing fired drafts expectTool: null, and says so", () => {
  const result = harvestCase({
    sessionId: "abcdef123456",
    messages: [userMsg(100, "just answer this")],
    events: [modelRequest(110), modelResponse(130)],
  });
  assert.equal(result.kase.expectTool, null);
  assert.equal(result.kase.expectInArgs, undefined);
  assert.ok(result.notes.some((n) => /No tool fired/.test(n)));
});

test("numbers and booleans become $eq, not substrings", () => {
  // A bare `1` would match `10` under substring semantics.
  const result = harvestCase({
    sessionId: "abcdef123456",
    messages: [userMsg(100, "read it")],
    events: [
      modelRequest(110),
      call(120, "read", { filePath: "a.ts", offset: 1, all: true }),
      output(125, "read"),
      modelResponse(130),
    ],
  });
  assert.deepEqual(result.kase.expectInArgs, {
    filePath: "a.ts",
    offset: { $eq: 1 },
    all: { $eq: true },
  });
});

test("long and multi-line argument values are not turned into needles", () => {
  const result = harvestCase({
    sessionId: "abcdef123456",
    messages: [userMsg(100, "edit it")],
    events: [
      modelRequest(110),
      call(120, "edit", {
        filePath: "a.ts",
        oldString: "line one\nline two",
        newString: "x".repeat(200),
      }),
      output(125, "edit"),
      modelResponse(130),
    ],
  });
  assert.deepEqual(result.kase.expectInArgs, { filePath: "a.ts" });
});

test("absolute paths are shortened, and the note says which", () => {
  const result = harvestCase({
    sessionId: "abcdef123456",
    messages: [userMsg(100, "read it")],
    events: [
      modelRequest(110),
      call(120, "read", { filePath: "/tmp/freecode-eval-Uaw72m/check.mjs" }),
      output(125, "read"),
      modelResponse(130),
    ],
  });
  assert.deepEqual(result.kase.expectInArgs, {
    filePath: "freecode-eval-Uaw72m/check.mjs",
  });
  assert.ok(result.notes.some((n) => /shortened/.test(n) && /filePath/.test(n)));
});

test("the first note warns that this is what happened, not what should", () => {
  // The failure mode of this command is a draft that reads as an approved
  // expectation.
  const result = harvestCase({
    sessionId: "abcdef123456",
    messages: [userMsg(100, "q")],
    events: [modelRequest(110), modelResponse(130)],
  });
  assert.match(result.notes[0], /what the agent DID, not what it should do/);
});

test("the model is pinned from the span that actually ran", () => {
  const result = harvestCase({
    sessionId: "abcdef123456",
    messages: [userMsg(100, "q")],
    events: [modelRequest(110), modelResponse(130)],
  });
  assert.equal(result.kase.model, "anthropic/claude-sonnet-5");
});

test("shortenPath leaves relative values alone", () => {
  assert.equal(shortenPath("apps/core/src/eval/gate.ts"), "apps/core/src/eval/gate.ts");
  assert.equal(shortenPath("gate.ts"), "gate.ts");
  assert.equal(shortenPath("/a/b/c/d.ts"), "c/d.ts");
});

test("caseId is a stable slug that keeps two harvests apart", () => {
  const a = caseId("Where is HANG_THRESHOLD_MS defined?", "abcdef123456", 1);
  const b = caseId("Where is HANG_THRESHOLD_MS defined?", "abcdef123456", 2);
  assert.equal(a, "where-is-hang-threshold-ms-defined-abcdef-t1");
  assert.notEqual(a, b);
  assert.equal(caseId("!!!", "abcdef123456", 1), "harvested-abcdef-t1");
});

test("formatCase emits one line with a stable key order", () => {
  const line = formatCase({
    expectMaxTurns: 3,
    prompt: "p",
    id: "c",
    expectTool: "grep",
  });
  assert.equal(
    line,
    `{"id":"c","prompt":"p","expectTool":"grep","expectMaxTurns":3}`,
  );
  assert.equal(line.includes("\n"), false);
});
