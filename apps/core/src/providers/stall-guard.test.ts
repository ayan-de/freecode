import test from "node:test";
import assert from "node:assert/strict";
import {
  ProviderStallError,
  linkAbort,
  withStallTimeout,
} from "./stall-guard.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function collect<T>(source: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const value of source) out.push(value);
  return out;
}

test("passes a healthy stream through untouched", async () => {
  async function* source() {
    yield 1;
    await sleep(5);
    yield 2;
    yield 3;
  }
  const got = await collect(
    withStallTimeout(source(), { firstChunkMs: 200, stallMs: 200 }),
  );
  assert.deepEqual(got, [1, 2, 3]);
});

test("throws when the first chunk never arrives", async () => {
  async function* source() {
    await sleep(400);
    yield "never";
  }
  await assert.rejects(
    () => collect(withStallTimeout(source(), { firstChunkMs: 20 })),
    (err: unknown) => {
      assert.ok(err instanceof ProviderStallError);
      assert.equal(err.chunksReceived, 0);
      assert.match(err.message, /no response/);
      return true;
    },
  );
});

test("throws when the stream dies mid-flight, reporting progress", async () => {
  async function* source() {
    yield "a";
    yield "b";
    await sleep(400);
    yield "c";
  }
  await assert.rejects(
    () =>
      collect(withStallTimeout(source(), { firstChunkMs: 200, stallMs: 20 })),
    (err: unknown) => {
      assert.ok(err instanceof ProviderStallError);
      assert.equal(err.chunksReceived, 2);
      assert.match(err.message, /went silent/);
      return true;
    },
  );
});

test("a slow but steady stream is not a stall", async () => {
  async function* source() {
    for (let i = 0; i < 5; i++) {
      await sleep(15);
      yield i;
    }
  }
  const got = await collect(
    withStallTimeout(source(), { firstChunkMs: 100, stallMs: 60 }),
  );
  assert.deepEqual(got, [0, 1, 2, 3, 4]);
});

test("onStall fires once so the caller can kill the request", async () => {
  async function* source() {
    await sleep(400);
    yield 1;
  }
  let stalls = 0;
  await assert.rejects(() =>
    collect(
      withStallTimeout(source(), {
        firstChunkMs: 20,
        onStall: () => stalls++,
      }),
    ),
  );
  assert.equal(stalls, 1);
});

test("closes the source iterator when the consumer breaks early", async () => {
  let closed = false;
  const source: AsyncIterable<number> = {
    [Symbol.asyncIterator]() {
      let i = 0;
      return {
        async next() {
          return { value: i++, done: false };
        },
        async return() {
          closed = true;
          return { value: undefined, done: true as const };
        },
      };
    },
  };

  for await (const value of withStallTimeout(source, { stallMs: 200 })) {
    if (value === 2) break;
  }
  assert.equal(closed, true);
});

test("a zero budget disables the timeout", async () => {
  async function* source() {
    await sleep(40);
    yield "late";
  }
  const got = await collect(
    withStallTimeout(source(), { firstChunkMs: 0, stallMs: 0 }),
  );
  assert.deepEqual(got, ["late"]);
});

test("linkAbort propagates a parent abort", () => {
  const parent = new AbortController();
  const child = linkAbort(parent.signal);
  assert.equal(child.signal.aborted, false);
  parent.abort();
  assert.equal(child.signal.aborted, true);
});

test("linkAbort inherits an already-aborted parent", () => {
  const parent = new AbortController();
  parent.abort();
  assert.equal(linkAbort(parent.signal).signal.aborted, true);
});

test("aborting the child leaves the parent alone", () => {
  const parent = new AbortController();
  const child = linkAbort(parent.signal);
  child.abort();
  assert.equal(parent.signal.aborted, false);
});
