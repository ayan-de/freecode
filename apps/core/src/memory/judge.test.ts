import test from "node:test";
import assert from "node:assert/strict";
import {
  isDegradation,
  judgeMemories,
  parseKeepIndices,
  type JudgeDecision,
} from "./judge.js";
import type { MemoryEntry } from "./mem-types.js";

function mem(name: string): MemoryEntry {
  return {
    name,
    description: `description of ${name}`,
    type: "project",
    content: `body of ${name}`,
    createdAt: 0,
    updatedAt: 0,
  };
}

const CANDIDATES = [mem("a"), mem("b"), mem("c")];

const judge = (raw: string) =>
  judgeMemories({
    query: "q",
    candidates: CANDIDATES,
    provider: "test",
    complete: async () => raw,
  });

test("keeps exactly the named memories", async () => {
  const r = await judge("[1,3]");
  assert.deepEqual(
    r.kept.map((m) => m.name),
    ["a", "c"],
  );
  assert.equal(r.decision, "judge_ran");
});

test("an empty verdict is a real answer, not a failure", async () => {
  const r = await judge("[]");
  assert.deepEqual(r.kept, []);
  assert.equal(r.decision, "judge_ran", "abstention is the productive path");
  assert.equal(isDegradation(r.decision), false);
});

test("kept memories stay in cascade order, not the model's order", async () => {
  // The byte-budget renderer sheds from the end, so the incoming relevance
  // order has to survive judging.
  const r = await judge("[3,1]");
  assert.deepEqual(
    r.kept.map((m) => m.name),
    ["a", "c"],
  );
});

test("tolerates a code fence and surrounding prose", async () => {
  const r = await judge("Sure!\n```json\n[2]\n```\nHope that helps.");
  assert.deepEqual(
    r.kept.map((m) => m.name),
    ["b"],
  );
});

test("out-of-range and duplicate indices are discarded, siblings survive", async () => {
  const r = await judge("[0, 2, 2, 99, -1]");
  assert.deepEqual(
    r.kept.map((m) => m.name),
    ["b"],
  );
  assert.equal(r.decision, "judge_ran");
});

test("an unparseable verdict drops the candidates and is counted", async () => {
  const r = await judge("I think memory two is relevant.");
  assert.deepEqual(r.kept, [], "fails closed");
  assert.equal(r.decision, "unparseable");
  assert.ok(isDegradation(r.decision), "and is a degradation, not an opt-out");
});

test("a throwing provider drops the candidates and never rejects", async () => {
  const r = await judgeMemories({
    query: "q",
    candidates: CANDIDATES,
    provider: "test",
    complete: async () => {
      throw new Error("transport exploded");
    },
  });
  assert.deepEqual(r.kept, []);
  assert.equal(r.decision, "failed");
  assert.ok(isDegradation(r.decision));
});

test("no candidates short-circuits without calling the provider", async () => {
  let called = false;
  const r = await judgeMemories({
    query: "q",
    candidates: [],
    provider: "test",
    complete: async () => {
      called = true;
      return "[1]";
    },
  });
  assert.equal(r.decision, "no_candidates");
  assert.equal(called, false, "no call is made for an empty candidate set");
});

test("only transport and parse failures count as degradations", () => {
  const intended: JudgeDecision[] = ["judge_ran", "disabled", "no_candidates"];
  for (const d of intended) {
    assert.equal(isDegradation(d), false, `${d} is intended`);
  }
  assert.equal(isDegradation("no_provider"), false, "misconfiguration, not decay");
  for (const d of ["unparseable", "failed"] as JudgeDecision[]) {
    assert.equal(isDegradation(d), true, `${d} is a degradation`);
  }
});

test("parseKeepIndices distinguishes 'no verdict' from 'keep nothing'", () => {
  // The distinction the caller acts on: null means the model did not answer
  // the question (a degradation), [] means it answered "none of them" (the
  // productive path). Conflating them would count every abstention as a fault.
  assert.equal(parseKeepIndices("nope", 3), null, "no array at all");
  assert.deepEqual(parseKeepIndices("[]", 3), []);
});

test("parseKeepIndices digs the array out of a wrapper object", () => {
  // Models wrap the answer however firmly you ask them not to — extract.ts
  // makes the same allowance. An array found anywhere in the reply is the
  // verdict; a reply with no array at all is not.
  assert.deepEqual(parseKeepIndices('{"keep":[1]}', 3), [1]);
  assert.deepEqual(parseKeepIndices("The answer is [2].", 3), [2]);
});
