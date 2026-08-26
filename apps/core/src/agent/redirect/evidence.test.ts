import test from "node:test";
import assert from "node:assert/strict";
import { buildEvidence, EVIDENCE_CHAR_CAP } from "./evidence.js";
import { renderEvidence } from "./prompt.js";
import type { RolloutEvent } from "../../rollout/types.js";

let seq = 0;
function call(tool: string, args: Record<string, unknown>): RolloutEvent {
  seq++;
  return {
    id: `call-${seq}`,
    seq,
    aggregateID: "s",
    timestamp: 1000 + seq,
    type: "function.call",
    turnId: "turn-1",
    tool,
    args,
  } as RolloutEvent;
}

function output(tool: string, out: string, failed?: boolean): RolloutEvent {
  seq++;
  return {
    id: `out-${seq}`,
    seq,
    aggregateID: "s",
    timestamp: 1000 + seq,
    type: "function.output",
    turnId: "turn-1",
    tool,
    output: out,
    duration_ms: 5,
    ...(failed === undefined ? {} : { failed }),
  } as RolloutEvent;
}

function pair(
  tool: string,
  args: Record<string, unknown>,
  out = "ok",
  failed?: boolean,
): RolloutEvent[] {
  return [call(tool, args), output(tool, out, failed)];
}

const base = {
  sessionId: "s",
  turnCount: 9,
  goal: "Find where the timeout is configured",
  todos: [],
};

test("an empty log yields an empty, still-valid packet", () => {
  const packet = buildEvidence({ ...base, reason: "no_progress", events: [] });
  assert.deepEqual(packet.recentCalls, []);
  assert.deepEqual(packet.changedFiles, []);
  assert.deepEqual(packet.errors, []);
  assert.deepEqual(packet.evidenceEventIds, []);
  assert.equal(packet.goal, base.goal);
});

test("recent calls carry the tool, an arg digest, and whether it failed", () => {
  const events = [
    ...pair("grep", { pattern: "TODO" }),
    ...pair("read", { filePath: "/p/a.ts" }, "no such file", true),
  ];
  const packet = buildEvidence({ ...base, reason: "no_progress", events });

  assert.equal(packet.recentCalls.length, 2);
  assert.equal(packet.recentCalls[0].tool, "grep");
  assert.match(packet.recentCalls[0].args, /pattern/);
  assert.equal(packet.recentCalls[0].failed, false);
  assert.equal(packet.recentCalls[1].failed, true);
  assert.deepEqual(packet.errors, ["no such file"]);
});

test("only the last 12 calls survive", () => {
  const events: RolloutEvent[] = [];
  for (let i = 0; i < 30; i++)
    events.push(...pair("grep", { pattern: `p${i}` }));
  const packet = buildEvidence({ ...base, reason: "no_progress", events });

  assert.equal(packet.recentCalls.length, 12);
  assert.match(packet.recentCalls[11].args, /p29/, "the newest call is kept");
});

test("changed files come from successful mutating calls only", () => {
  const events = [
    ...pair("write", { filePath: "/p/new.ts" }),
    ...pair("edit", { filePath: "/p/broken.ts" }, "oldString not found", true),
    ...pair("read", { filePath: "/p/read-only.ts" }),
    ...pair("write", { filePath: "/p/new.ts" }),
  ];
  const packet = buildEvidence({ ...base, reason: "no_progress", events });

  assert.deepEqual(
    packet.changedFiles,
    ["/p/new.ts"],
    "failed edits and reads do not change a file, and duplicates collapse",
  );
});

test("the repeated signature names the call and its count", () => {
  const events: RolloutEvent[] = [];
  for (let i = 0; i < 4; i++) events.push(...pair("grep", { pattern: "same" }));
  events.push(...pair("read", { filePath: "/p/a.ts" }));
  const packet = buildEvidence({
    ...base,
    reason: "repeated_identical_tool",
    events,
  });

  assert.ok(packet.repeatedSignature);
  assert.match(packet.repeatedSignature!, /grep/);
  assert.match(packet.repeatedSignature!, /×4/);
});

test("a signature is only reported for the repetition reason", () => {
  const events = [
    ...pair("grep", { pattern: "x" }),
    ...pair("grep", { pattern: "x" }),
  ];
  const packet = buildEvidence({ ...base, reason: "no_progress", events });
  assert.equal(packet.repeatedSignature, undefined);
});

test("at most 3 distinct errors, newest first, 200 chars each", () => {
  const events = [
    ...pair("read", { filePath: "/1" }, "error one", true),
    ...pair("read", { filePath: "/2" }, "error two", true),
    ...pair("read", { filePath: "/3" }, "error two", true),
    ...pair("read", { filePath: "/4" }, "error three", true),
    ...pair("read", { filePath: "/5" }, "x".repeat(500), true),
  ];
  const packet = buildEvidence({ ...base, reason: "no_progress", events });

  assert.equal(packet.errors.length, 3);
  assert.equal(packet.errors[0].length, 200, "the newest error is truncated");
  assert.equal(packet.errors[1], "error three");
  assert.ok(!packet.errors.includes("error one"), "oldest is dropped");
});

test("an output that did not fail is not an error, however it reads", () => {
  const events = pair("bash", { command: "test" }, "Error: nothing is wrong");
  const packet = buildEvidence({ ...base, reason: "no_progress", events });
  assert.deepEqual(packet.errors, [], "the flag decides, not the wording");
});

test("a truncated log with an unpaired call does not throw", () => {
  const events = [call("grep", { pattern: "x" })];
  const packet = buildEvidence({ ...base, reason: "no_progress", events });
  assert.deepEqual(packet.recentCalls, [], "an unclosed call has no span yet");
});

test("the goal is truncated to 400 characters", () => {
  const packet = buildEvidence({
    ...base,
    goal: "g".repeat(900),
    reason: "no_progress",
    events: [],
  });
  assert.equal(packet.goal.length, 400);
});

test("event ids are recorded so the packet can be reconstructed", () => {
  const events = [...pair("grep", { pattern: "x" })];
  const packet = buildEvidence({ ...base, reason: "no_progress", events });
  assert.deepEqual(packet.evidenceEventIds, [events[0].id, events[1].id]);
});

test("the rendered packet never exceeds the hard cap", () => {
  const events: RolloutEvent[] = [];
  for (let i = 0; i < 12; i++) {
    events.push(
      ...pair(
        "grep",
        { pattern: "y".repeat(400), path: "z".repeat(400) },
        "x".repeat(400),
        true,
      ),
    );
  }
  const packet = buildEvidence({
    ...base,
    goal: "g".repeat(400),
    reason: "repeated_identical_tool",
    events,
    todos: Array.from({ length: 20 }, (_, i) => ({
      content: `todo ${i} `.repeat(20),
      status: "pending",
    })),
  });

  const rendered = renderEvidence(packet);
  assert.ok(
    rendered.length <= EVIDENCE_CHAR_CAP,
    `rendered ${rendered.length} chars`,
  );
});

test("the rendered packet states the goal and the observed pattern", () => {
  const packet = buildEvidence({
    ...base,
    reason: "repeated_identical_tool",
    events: [...pair("grep", { pattern: "x" })],
  });
  const rendered = renderEvidence(packet);
  assert.match(rendered, /Goal: Find where the timeout/);
  assert.match(rendered, /repeated the same tool call/);
});
