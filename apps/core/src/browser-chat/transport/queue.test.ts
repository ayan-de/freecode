import test from "node:test";
import assert from "node:assert/strict";
import { ChunkQueue } from "./queue.js";

test("items pushed before a reader arrives are not lost", async () => {
  const q = new ChunkQueue<number>();
  q.push(1);
  q.push(2);
  q.close();
  const seen: number[] = [];
  for await (const item of q.drain()) seen.push(item);
  assert.deepEqual(seen, [1, 2]);
});

test("a parked reader is woken by a later push", async () => {
  const q = new ChunkQueue<string>();
  const collected: string[] = [];
  const reading = (async () => {
    for await (const item of q.drain()) collected.push(item);
  })();
  // Reader is parked here with an empty queue.
  await new Promise((r) => setTimeout(r, 10));
  q.push("late");
  q.close();
  await reading;
  assert.deepEqual(collected, ["late"]);
});

test("close releases a parked reader instead of hanging it", async () => {
  const q = new ChunkQueue<number>();
  const reading = (async () => {
    for await (const _ of q.drain()) void _;
    return "finished";
  })();
  await new Promise((r) => setTimeout(r, 10));
  q.close();
  assert.equal(await reading, "finished");
});

test("push after close is dropped", async () => {
  const q = new ChunkQueue<number>();
  q.close();
  q.push(99);
  const seen: number[] = [];
  for await (const item of q.drain()) seen.push(item);
  assert.deepEqual(seen, []);
});

test("an already-aborted signal stops the drain", async () => {
  const q = new ChunkQueue<number>();
  q.push(1);
  const controller = new AbortController();
  controller.abort();
  const seen: number[] = [];
  for await (const item of q.drain(controller.signal)) seen.push(item);
  assert.deepEqual(seen, []);
});
