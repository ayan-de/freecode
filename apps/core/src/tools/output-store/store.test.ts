import test from "node:test";
import assert from "node:assert/strict";
import { OutputStore } from "./store.js";
import { adaptiveTruncate } from "./truncate.js";

test("get returns the full stored output", () => {
  const s = new OutputStore();
  s.put("a", "line1\nline2\nline3");
  assert.equal(s.get("a"), "line1\nline2\nline3");
  assert.equal(s.get("missing"), undefined);
});

test("byte-LRU evicts the oldest when over cap", () => {
  const s = new OutputStore(20); // tiny cap
  s.put("a", "aaaaaaaa"); // 8 bytes
  s.put("b", "bbbbbbbb"); // 16 total
  s.put("c", "cccccccc"); // 24 → over 20, evict oldest (a)
  assert.equal(s.has("a"), false);
  assert.equal(s.get("c"), "cccccccc");
});

test("a single oversized output is kept alone", () => {
  const s = new OutputStore(4);
  s.put("big", "0123456789");
  assert.equal(s.get("big"), "0123456789"); // never evicts the just-added sole entry
});

test("slice returns a 1-based line window", () => {
  const s = new OutputStore();
  s.put("x", "l1\nl2\nl3\nl4\nl5");
  const r = s.slice("x", 2, 2);
  assert.deepEqual([r.found, r.text, r.totalLines], [true, "l2\nl3", 5]);
  assert.equal(s.slice("nope").found, false);
});

test("grep matches by regex, falls back to literal, prefixes line numbers", () => {
  const s = new OutputStore();
  s.put("x", "error: boom\nok\nERROR: bang");
  assert.equal(s.grep("x", "^error").text, "1: error: boom"); // regex
  assert.equal(s.grep("x", "[").text, ""); // invalid regex → literal "[", no match
});

test("grep with context includes ±N lines and a -- gap between runs", () => {
  const s = new OutputStore();
  s.put("x", "a\nHIT\nb\nc\nd\ne\nHIT\nf");
  const r = s.grep("x", "HIT", 1);
  // run 1: lines 1-3 (a, HIT, b); run 2: lines 6-8 (e, HIT, f); gap between.
  assert.equal(r.text, "1: a\n2: HIT\n3: b\n--\n6: e\n7: HIT\n8: f");
});

test("adaptiveTruncate keeps head AND tail with a retrieval marker", () => {
  const big = "H".repeat(24_000) + "M".repeat(10_000) + "T".repeat(6_000);
  const { modelOutput, truncated } = adaptiveTruncate(big, "call-1");
  assert.equal(truncated, true);
  assert.ok(modelOutput.startsWith("H"), "head preserved");
  assert.ok(modelOutput.endsWith("T"), "tail preserved");
  assert.ok(modelOutput.includes('id="call-1"'), "names the retrieval handle");
  assert.ok(!modelOutput.includes("M".repeat(10_000)), "middle dropped");
});

test("adaptiveTruncate passes short output through untouched", () => {
  const { modelOutput, truncated } = adaptiveTruncate("short", "call-2");
  assert.equal(truncated, false);
  assert.equal(modelOutput, "short");
});
