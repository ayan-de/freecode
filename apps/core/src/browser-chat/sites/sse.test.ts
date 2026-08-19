import test from "node:test";
import assert from "node:assert/strict";
import { createSseSplitter, parseSseFrame, parseFrameJson } from "./sse.js";
import { claudeAdapter } from "./claude.js";

test("splitter emits only complete frames", () => {
  const feed = createSseSplitter();
  assert.deepEqual(feed("data: a\n\ndata: b\n\n"), ["data: a", "data: b"]);
});

test("splitter holds a partial frame until the rest arrives", () => {
  const feed = createSseSplitter();
  // A network chunk can split anywhere, including mid-frame.
  assert.deepEqual(feed("data: hel"), []);
  assert.deepEqual(feed("lo\n\n"), ["data: hello"]);
});

test("splitter handles a separator split across chunks", () => {
  const feed = createSseSplitter();
  assert.deepEqual(feed("data: x\n"), []);
  assert.deepEqual(feed("\ndata: y\n\n"), ["data: x", "data: y"]);
});

test("splitter tolerates CRLF", () => {
  const feed = createSseSplitter();
  assert.deepEqual(feed("data: a\r\n\r\n"), ["data: a"]);
});

test("parseSseFrame reads event and joins multi-line data", () => {
  const frame = parseSseFrame("event: delta\ndata: one\ndata: two");
  assert.equal(frame.event, "delta");
  assert.equal(frame.data, "one\ntwo");
});

test("parseSseFrame strips exactly one leading space and skips comments", () => {
  const frame = parseSseFrame(": keep-alive\ndata:  spaced");
  assert.equal(frame.data, " spaced");
});

test("parseFrameJson returns null for [DONE] and junk", () => {
  assert.equal(parseFrameJson({ data: "[DONE]" }), null);
  assert.equal(parseFrameJson({ data: "not json" }), null);
  assert.deepEqual(parseFrameJson({ data: '{"a":1}' }), { a: 1 });
});

test("claude adapter decodes an Anthropic-style delta", () => {
  const chunk = claudeAdapter.decodeFrame(
    parseSseFrame(
      'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"text":"OK"}}',
    ),
  );
  assert.deepEqual(chunk, { type: "delta", text: "OK" });
});

test("claude adapter classifies a rate limit", () => {
  const chunk = claudeAdapter.decodeFrame(
    parseSseFrame('data: {"error":{"message":"You have hit your rate limit"}}'),
  );
  assert.equal(chunk?.type, "limit");
  assert.equal(
    chunk?.type === "limit" ? chunk.kind : undefined,
    "rate_limited",
  );
});

test("claude adapter classifies a full conversation", () => {
  const chunk = claudeAdapter.decodeFrame(
    parseSseFrame(
      'data: {"error":{"message":"This conversation is too long to continue"}}',
    ),
  );
  assert.equal(
    chunk?.type === "limit" ? chunk.kind : undefined,
    "thread_full",
  );
});

test("claude adapter ignores frames it does not recognise", () => {
  // Decoding nothing is correct here: inventing text from an unknown shape
  // would inject garbage into the model's reply.
  assert.equal(
    claudeAdapter.decodeFrame(parseSseFrame('data: {"type":"ping"}')),
    null,
  );
});

// --- shapes taken from the live capture in fixtures/claude-hello.txt --------

test("claude adapter reports quota from message_limit", () => {
  // Sent on EVERY reply, so quota is known before a limit is ever hit.
  const chunk = claudeAdapter.decodeFrame(
    parseSseFrame(
      'event: message_limit\ndata: {"type":"message_limit","message_limit":{"type":"within_limit","resetsAt":null,"windows":{"5h":{"status":"within_limit","resets_at":1787176800,"utilization":0.41},"7d":{"status":"within_limit","resets_at":1787209200,"utilization":0.05}}}}',
    ),
  );
  assert.equal(chunk?.type, "quota");
  if (chunk?.type === "quota") {
    // The tightest window is the one that bites first.
    assert.equal(chunk.window, "5h");
    assert.equal(chunk.utilization, 0.41);
    assert.equal(chunk.resetsAt, 1787176800 * 1000);
  }
});

test("claude adapter turns an exhausted message_limit into a rate limit", () => {
  const chunk = claudeAdapter.decodeFrame(
    parseSseFrame(
      'data: {"type":"message_limit","message_limit":{"type":"exceeded_limit","resetsAt":1787176800}}',
    ),
  );
  assert.equal(chunk?.type, "limit");
  if (chunk?.type === "limit") {
    assert.equal(chunk.kind, "rate_limited");
    assert.equal(chunk.resetAt, 1787176800 * 1000);
  }
});

test("claude adapter ignores message_start / content_block_start noise", () => {
  const start = claudeAdapter.decodeFrame(
    parseSseFrame(
      'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":"","citations":[]}}',
    ),
  );
  // An empty opening block must not be mistaken for content.
  assert.equal(start, null);
});
