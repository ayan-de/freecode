// =============================================================================
// queue-store unit tests
// Pure FIFO semantics — no async, no Effect runtime, no AgentLoop involvement.
// Spec: docs/superpowers/specs/2026-08-05-queued-messages-design.md
// =============================================================================

import test from "node:test";
import assert from "node:assert/strict";
import { createMessageQueue } from "./queue-store.js";

test("enqueue returns a non-empty id and shiftNext returns it in FIFO order", () => {
  const q = createMessageQueue();
  const id1 = q.enqueue("first");
  const id2 = q.enqueue("second");

  assert.equal(typeof id1, "string");
  assert.ok(id1.length > 0);
  assert.equal(q.size(), 2);

  const first = q.shiftNext();
  assert.deepEqual(first, { id: id1, content: "first" });
  const second = q.shiftNext();
  assert.deepEqual(second, { id: id2, content: "second" });
  assert.equal(q.shiftNext(), undefined);
  assert.equal(q.size(), 0);
});

test("shiftNext on an empty queue returns undefined (idempotent)", () => {
  const q = createMessageQueue();
  assert.equal(q.shiftNext(), undefined);
  assert.equal(q.shiftNext(), undefined);
  assert.equal(q.size(), 0);
});

test("removeById removes the matching id only", () => {
  const q = createMessageQueue();
  const id1 = q.enqueue("a");
  const id2 = q.enqueue("b");
  const id3 = q.enqueue("c");

  assert.equal(q.removeById(id2), true);
  assert.equal(q.size(), 2);

  // FIFO still holds among the survivors
  assert.deepEqual(q.shiftNext(), { id: id1, content: "a" });
  assert.deepEqual(q.shiftNext(), { id: id3, content: "c" });
  assert.equal(q.shiftNext(), undefined);
});

test("removeById returns false for an unknown id (no-op, spec 2026-08-05)", () => {
  const q = createMessageQueue();
  q.enqueue("a");
  assert.equal(q.removeById("does-not-exist"), false);
  assert.equal(q.size(), 1);
  // The drain after a no-op dequeue must still see the queued message.
  const next = q.shiftNext();
  assert.deepEqual(next, { id: next?.id, content: "a" });
});

test("clear empties the queue (used by session.delete)", () => {
  const q = createMessageQueue();
  q.enqueue("a");
  q.enqueue("b");
  q.clear();
  assert.equal(q.size(), 0);
  assert.equal(q.shiftNext(), undefined);
});

test("two queues are independent (per-session isolation)", () => {
  const a = createMessageQueue();
  const b = createMessageQueue();
  a.enqueue("a-only");
  b.enqueue("b-only");
  assert.equal(a.size(), 1);
  assert.equal(b.size(), 1);
  // Pull each queue's only item — they must not interfere.
  const aNext = a.shiftNext();
  const bNext = b.shiftNext();
  assert.equal(aNext?.content, "a-only");
  assert.equal(bNext?.content, "b-only");
  assert.notEqual(aNext?.id, bNext?.id);
  assert.equal(a.size(), 0);
  assert.equal(b.size(), 0);
});