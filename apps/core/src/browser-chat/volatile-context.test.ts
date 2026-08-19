import test from "node:test";
import assert from "node:assert/strict";
import { SentLog } from "./thread.js";
import type { Message } from "../agent/types.js";

function dynamicContext(content: string): Message {
  // Mirrors agent/loop.ts:1672 — fixed id, timestamp 0, content that carries
  // the file tree, git head and a clock, so it changes every single turn.
  return {
    id: "dynamic-context",
    role: "user",
    parts: [{ type: "text", content }],
    timestamp: 0,
  };
}

function user(id: string, content: string): Message {
  return { id, role: "user", parts: [{ type: "text", content }], timestamp: 0 };
}

test("REGRESSION: changing project context does not force a rebootstrap", () => {
  // Without the volatile exemption the classifier reads the loop's per-turn
  // rewrite of `dynamic-context` as "a message we sent was edited" and
  // rebootstraps EVERY turn — making the most expensive operation the default.
  const log = new SentLog();
  const turn1 = [dynamicContext("tree @ 10:15"), user("a", "start")];
  log.commit(turn1);

  const turn2 = [
    dynamicContext("tree @ 10:42"), // same id, different content
    user("a", "start"),
    user("b", "next"),
  ];
  const result = log.classify(turn2);
  assert.equal(result.kind, "append");
  assert.deepEqual(
    result.kind === "append" ? result.newMessages.map((m) => m.id) : [],
    ["b"],
  );
});

test("the volatile message is never counted as new work to send", () => {
  const log = new SentLog();
  log.commit([user("a", "start")]);
  const result = log.classify([dynamicContext("tree"), user("a", "start")]);
  // Nothing new: the context is handled as a delta, not as a message.
  assert.equal(result.kind, "append");
  assert.deepEqual(
    result.kind === "append" ? result.newMessages : [],
    [],
  );
});

test("a genuinely new session is still a contradiction", () => {
  const log = new SentLog();
  log.commit([user("a", "start")]);
  const result = log.classify([dynamicContext("tree"), user("z", "other")]);
  assert.equal(result.kind, "contradiction");
});
