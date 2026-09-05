import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as http from "http";
import * as os from "os";
import * as path from "path";
import { startProxy, type LoggedCall } from "./server.js";

function tmpLog(): string {
  return path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), "agent-bench-proxy-")),
    "proxy.jsonl",
  );
}

function listen(
  handler: http.RequestListener,
): Promise<{ origin: string; close: () => Promise<void> }> {
  const server = http.createServer(handler);
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") throw new Error("no port");
      resolve({
        origin: `http://127.0.0.1:${addr.port}`,
        close: () =>
          new Promise((r, j) => server.close((e) => (e ? j(e) : r()))),
      });
    });
  });
}

function readLog(file: string): LoggedCall[] {
  return fs
    .readFileSync(file, "utf-8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as LoggedCall);
}

test("forwards the body unchanged and records Anthropic usage from the reply", async () => {
  const logPath = tmpLog();
  let hits = 0;
  const upstream = await listen((req, res) => {
    hits++;
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      assert.equal(Buffer.concat(chunks).toString(), '{"model":"MiniMax-M3"}');
      assert.equal(req.headers["x-api-key"], "secret");
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          usage: { input_tokens: 12, output_tokens: 3, cache_read_input_tokens: 8 },
        }),
      );
    });
  });
  const proxy = await startProxy({ upstream: upstream.origin, logPath });
  try {
    const res = await fetch(`${proxy.origin}/v1/messages`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": "secret" },
      body: '{"model":"MiniMax-M3"}',
    });
    assert.equal(res.status, 200);
    assert.equal(hits, 1);
    const body = await res.json();
    assert.equal((body as { usage: { input_tokens: number } }).usage.input_tokens, 12);

    const [row] = readLog(logPath);
    assert.equal(row.method, "POST");
    assert.equal(row.path, "/v1/messages");
    assert.equal(row.status, 200);
    assert.equal(row.model, "MiniMax-M3");
    // Wire input_tokens (12) is exclusive; the log normalizes to inclusive.
    assert.deepEqual(row.usage, {
      inputTokens: 20,
      outputTokens: 3,
      cacheReadTokens: 8,
      cacheWriteTokens: 0,
    });
    assert.equal(row.modelEndpoint, true);
    assert.equal(JSON.stringify(row).includes("secret"), false);
  } finally {
    await proxy.close();
    await upstream.close();
  }
});

test("does not retry a 500 — a retry would be an optimization of one side", async () => {
  const logPath = tmpLog();
  let hits = 0;
  const upstream = await listen((_req, res) => {
    hits++;
    res.statusCode = 500;
    res.end("nope");
  });
  const proxy = await startProxy({ upstream: upstream.origin, logPath });
  try {
    const res = await fetch(`${proxy.origin}/v1/messages`, { method: "POST" });
    assert.equal(res.status, 500);
    assert.equal(hits, 1);
    assert.equal(await res.text(), "nope");
  } finally {
    await proxy.close();
    await upstream.close();
  }
});

test("SSE streams through and usage is taken from the last event", async () => {
  const logPath = tmpLog();
  const sse = [
    "event: message_start",
    'data: {"type":"message_start","message":{"usage":{"input_tokens":4,"output_tokens":1}}}',
    "",
    "event: message_delta",
    'data: {"type":"message_delta","usage":{"output_tokens":9}}',
    "",
  ].join("\n");
  const upstream = await listen((_req, res) => {
    res.setHeader("content-type", "text/event-stream");
    res.end(sse);
  });
  const proxy = await startProxy({ upstream: upstream.origin, logPath });
  try {
    const res = await fetch(`${proxy.origin}/v1/messages`, { method: "POST" });
    assert.equal(await res.text(), sse);
    const [row] = readLog(logPath);
    assert.equal(row.usage?.outputTokens, 9);
    assert.equal(row.usage?.inputTokens, 4);
  } finally {
    await proxy.close();
    await upstream.close();
  }
});

test("a request that is not the model endpoint is recorded as a leak", async () => {
  const logPath = tmpLog();
  const upstream = await listen((_req, res) => {
    res.end("ok");
  });
  const proxy = await startProxy({ upstream: upstream.origin, logPath });
  try {
    await fetch(`${proxy.origin}/repos/django/django`);
    const [row] = readLog(logPath);
    assert.equal(row.path, "/repos/django/django");
    assert.equal(row.modelEndpoint, false);
  } finally {
    await proxy.close();
    await upstream.close();
  }
});
