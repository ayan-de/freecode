import assert from "node:assert/strict";
import test from "node:test";
import { copyToClipboard, OSC52_CAP_BASE64_BYTES } from "./clipboard.js";

test("copyToClipboard writes a bare OSC 52 sequence outside tmux", () => {
  const calls: string[] = [];
  const result = copyToClipboard("hello", { write: (s) => calls.push(s), env: {} });
  assert.deepEqual(result, { copied: "hello", truncated: false });
  const expected = `\x1b]52;c;${Buffer.from("hello").toString("base64")}\x07`;
  assert.equal(calls[0], expected);
});

test("copyToClipboard wraps the sequence for tmux passthrough, doubling the inner ESC", () => {
  const calls: string[] = [];
  copyToClipboard("hi", {
    write: (s) => calls.push(s),
    env: { TMUX: "/tmp/tmux-1000/default,123,0" },
  });
  const inner = `\x1b]52;c;${Buffer.from("hi").toString("base64")}\x07`;
  const expected = `\x1bPtmux;${inner.replace(/\x1b/g, "\x1b\x1b")}\x1b\\`;
  assert.equal(calls[0], expected);
});

test("copyToClipboard head-truncates text over the cap and reports truncation", () => {
  const calls: string[] = [];
  const big = "x".repeat(OSC52_CAP_BASE64_BYTES);
  const result = copyToClipboard(big, { write: (s) => calls.push(s), env: {} });
  assert.equal(result.truncated, true);
  assert.ok(result.copied.length < big.length);
  assert.ok(big.startsWith(result.copied));
  const sentBase64 = /c;([^\x07]+)\x07/.exec(calls[0])![1];
  assert.ok(sentBase64.length <= OSC52_CAP_BASE64_BYTES);
});

test("copyToClipboard does not truncate text under the cap", () => {
  const calls: string[] = [];
  const result = copyToClipboard("short text", { write: (s) => calls.push(s), env: {} });
  assert.equal(result.truncated, false);
  assert.equal(result.copied, "short text");
});
