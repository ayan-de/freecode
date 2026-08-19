import test from "node:test";
import assert from "node:assert/strict";
import { SentLog } from "./thread.js";
import type { Message } from "../agent/types.js";

function msg(id: string, content: string, role: Message["role"] = "user"): Message {
  return { id, role, parts: [{ type: "text", content }], timestamp: 0 };
}

test("an empty log means bootstrap", () => {
  assert.deepEqual(new SentLog().classify([msg("a", "hi")]), { kind: "fresh" });
});

test("appended messages are the delta", () => {
  const log = new SentLog();
  const first = [msg("a", "hi")];
  log.commit(first);
  const result = log.classify([...first, msg("b", "again")]);
  assert.equal(result.kind, "append");
  assert.deepEqual(
    result.kind === "append" ? result.newMessages.map((m) => m.id) : [],
    ["b"],
  );
});

test("COMPACTION: dropped history is benign, not a rebootstrap", () => {
  // The whole point of the sent log. The site still holds a/b even though
  // local history no longer does.
  const log = new SentLog();
  log.commit([msg("a", "1"), msg("b", "2"), msg("c", "3")]);
  const afterCompaction = [msg("c", "3"), msg("d", "4")];
  const result = log.classify(afterCompaction);
  assert.equal(result.kind, "append");
  assert.deepEqual(
    result.kind === "append" ? result.newMessages.map((m) => m.id) : [],
    ["d"],
  );
});

test("an edited message we already sent is a contradiction", () => {
  const log = new SentLog();
  log.commit([msg("a", "original")]);
  const result = log.classify([msg("a", "edited"), msg("b", "next")]);
  assert.equal(result.kind, "contradiction");
});

test("a message inserted mid-history is a contradiction", () => {
  const log = new SentLog();
  log.commit([msg("a", "1"), msg("b", "2")]);
  const result = log.classify([msg("a", "1"), msg("x", "inserted"), msg("b", "2")]);
  assert.equal(result.kind, "contradiction");
});

test("a completely different session is a contradiction", () => {
  const log = new SentLog();
  log.commit([msg("a", "1")]);
  const result = log.classify([msg("y", "other"), msg("z", "other")]);
  assert.equal(result.kind, "contradiction");
});

test("reset returns the log to bootstrap state", () => {
  const log = new SentLog();
  log.commit([msg("a", "1")]);
  log.reset();
  assert.deepEqual(log.classify([msg("a", "1")]), { kind: "fresh" });
});

test("assistant messages are tracked too, so they are never re-sent", () => {
  const log = new SentLog();
  log.commit([msg("a", "hi"), msg("b", "reply", "assistant")]);
  const result = log.classify([
    msg("a", "hi"),
    msg("b", "reply", "assistant"),
    msg("c", "next"),
  ]);
  assert.equal(result.kind, "append");
  assert.deepEqual(
    result.kind === "append" ? result.newMessages.map((m) => m.id) : [],
    ["c"],
  );
});
