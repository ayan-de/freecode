import assert from "node:assert/strict";
import test from "node:test";
import { cacheHitRate, formatTokenCount } from "./format-tokens.js";

test("formatTokenCount abbreviates at thousand and million", () => {
  assert.equal(formatTokenCount(999), "999");
  assert.equal(formatTokenCount(12_300), "12.3k");
  assert.equal(formatTokenCount(1_500_000), "1.5M");
});

test("cacheHitRate is the share of billed input served from cache", () => {
  // 90k of 100k billed input came from cache.
  assert.equal(cacheHitRate(10_000, 90_000), 90);
  assert.equal(cacheHitRate(50_000, 50_000), 50);
  assert.equal(cacheHitRate(100_000, 0), 0);
});

test("cacheHitRate does not double-count cache writes", () => {
  // The loop folds writes into inputTokens because they are billed input, so
  // a turn of 20k fresh + 30k write arrives as inputTokens=50k. With 50k read
  // that is exactly half the billed input, not a third.
  assert.equal(cacheHitRate(50_000, 50_000), 50);
});

test("cacheHitRate returns undefined when there is nothing billed", () => {
  assert.equal(cacheHitRate(0, 0), undefined);
});
