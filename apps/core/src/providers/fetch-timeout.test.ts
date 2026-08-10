import test from "node:test";
import assert from "node:assert/strict";
import {
  HeaderTimeoutError,
  StreamStallError,
  createTimeoutFetch,
  isTimeoutError,
} from "./fetch-timeout.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const SSE = { "content-type": "text/event-stream" };

/** An SSE response whose events arrive on the given schedule. */
function sseResponse(events: Array<{ afterMs: number; data: string }>) {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream<Uint8Array>({
      async start(controller) {
        for (const event of events) {
          await sleep(event.afterMs);
          controller.enqueue(encoder.encode(`data: ${event.data}\n\n`));
        }
        controller.close();
      },
    }),
    { headers: SSE },
  );
}

async function drain(response: Response): Promise<string> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let out = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    out += decoder.decode(value);
  }
  return out;
}

test("passes a healthy SSE stream through", async () => {
  const fetchImpl = async () =>
    sseResponse([
      { afterMs: 5, data: "a" },
      { afterMs: 5, data: "b" },
    ]);
  const f = createTimeoutFetch({ fetchImpl, sseStallTimeoutMs: 200 });
  const body = await drain(await f("https://x"));
  assert.match(body, /data: a/);
  assert.match(body, /data: b/);
});

test("a slow but steady stream survives — this is the false-kill regression", async () => {
  // Each gap is under budget but the total far exceeds it. The old
  // chunk-level guard measured the wrong thing and would have aborted this.
  const fetchImpl = async () =>
    sseResponse([
      { afterMs: 30, data: "1" },
      { afterMs: 30, data: "2" },
      { afterMs: 30, data: "3" },
      { afterMs: 30, data: "4" },
    ]);
  const f = createTimeoutFetch({ fetchImpl, sseStallTimeoutMs: 60 });
  const body = await drain(await f("https://x"));
  assert.equal((body.match(/data:/g) ?? []).length, 4);
});

test("keep-alives with no content still count as liveness", async () => {
  // A reasoning model emits these while thinking. They carry nothing the
  // normalizer would forward, which is exactly why the bound lives here.
  const fetchImpl = async () =>
    sseResponse([
      { afterMs: 30, data: "" },
      { afterMs: 30, data: "" },
      { afterMs: 30, data: "real" },
    ]);
  const f = createTimeoutFetch({ fetchImpl, sseStallTimeoutMs: 60 });
  assert.match(await drain(await f("https://x")), /data: real/);
});

test("a genuinely silent stream is cut off", async () => {
  const fetchImpl = async () =>
    sseResponse([
      { afterMs: 5, data: "start" },
      { afterMs: 5_000, data: "never" },
    ]);
  const f = createTimeoutFetch({ fetchImpl, sseStallTimeoutMs: 40 });
  const response = await f("https://x");
  await assert.rejects(
    () => drain(response),
    (err: unknown) => {
      assert.ok(err instanceof StreamStallError);
      assert.ok(isTimeoutError(err));
      return true;
    },
  );
});

test("headers that never arrive raise HeaderTimeoutError", async () => {
  const fetchImpl = ((_input: unknown, init?: { signal?: AbortSignal }) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () =>
        reject(new Error("aborted")),
      );
    })) as unknown as typeof fetch;

  const f = createTimeoutFetch({ fetchImpl, headerTimeoutMs: 40 });
  await assert.rejects(
    () => f("https://x"),
    (err: unknown) => {
      assert.ok(err instanceof HeaderTimeoutError);
      assert.match(err.message, /no response headers/);
      return true;
    },
  );
});

test("the header timeout stops applying once headers arrive", async () => {
  // The whole point of a header bound: it must not cap generation time. A
  // stream that takes far longer than the header budget is still healthy.
  const fetchImpl = async () =>
    sseResponse([
      { afterMs: 10, data: "1" },
      { afterMs: 60, data: "2" },
      { afterMs: 60, data: "3" },
    ]);
  const f = createTimeoutFetch({
    fetchImpl,
    headerTimeoutMs: 40,
    sseStallTimeoutMs: 500,
  });
  const body = await drain(await f("https://x"));
  assert.equal((body.match(/data:/g) ?? []).length, 3);
});

test("non-SSE responses are passed through untouched", async () => {
  const fetchImpl = async () =>
    new Response(JSON.stringify({ ok: true }), {
      headers: { "content-type": "application/json" },
    });
  const f = createTimeoutFetch({ fetchImpl, sseStallTimeoutMs: 1 });
  await sleep(20);
  assert.deepEqual(await (await f("https://x")).json(), { ok: true });
});

test("a zero budget disables each bound", async () => {
  const fetchImpl = async () => {
    await sleep(60);
    return sseResponse([{ afterMs: 60, data: "late" }]);
  };
  const f = createTimeoutFetch({
    fetchImpl,
    headerTimeoutMs: 0,
    sseStallTimeoutMs: 0,
  });
  assert.match(await drain(await f("https://x")), /data: late/);
});

test("the caller's own abort signal still works", async () => {
  const controller = new AbortController();
  const fetchImpl = ((_input: unknown, init?: { signal?: AbortSignal }) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () =>
        reject(new Error("aborted by caller")),
      );
    })) as unknown as typeof fetch;

  const f = createTimeoutFetch({ fetchImpl, headerTimeoutMs: 5_000 });
  const pending = f("https://x", { signal: controller.signal });
  controller.abort();
  await assert.rejects(() => pending, /aborted by caller/);
});
