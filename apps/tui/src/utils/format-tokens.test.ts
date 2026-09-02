import assert from "node:assert/strict";
import test from "node:test";
import { cacheHitRate, formatTokenCount } from "./format-tokens.js";

test("formatTokenCount abbreviates at thousand and million", () => {
  assert.equal(formatTokenCount(999), "999");
  assert.equal(formatTokenCount(12_300), "12.3k");
  assert.equal(formatTokenCount(1_500_000), "1.5M");
});

test("cacheHitRate is the share of billed input served from cache", () => {
  // Inclusive input: 90k of 100k came from cache.
  assert.equal(cacheHitRate(100_000, 90_000), 90);
  assert.equal(cacheHitRate(100_000, 50_000), 50);
  assert.equal(cacheHitRate(100_000, 0), 0);
});

test("cacheHitRate does not add cache reads into the denominator twice", () => {
  // 20k fresh + 30k write + 50k read = 100k inclusive input, 50% hit.
  // Treating input as exclusive of reads (50k + 50k read) understated the
  // same turn as 50% when every token was cached, or 46% on a 87% day.
  assert.equal(cacheHitRate(100_000, 50_000), 50);
  assert.equal(cacheHitRate(100_000, 100_000), 100);
});

test("cacheHitRate returns undefined when there is nothing billed", () => {
  assert.equal(cacheHitRate(0, 0), undefined);
});
