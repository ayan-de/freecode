import test from "node:test";
import assert from "node:assert/strict";
import {
  noteSendAndCheckCold,
  summarizeCache,
  disposeCacheAwareness,
} from "./cache-awareness.js";

const FIVE_MIN = 5 * 60 * 1000;

test("first send never warns (nothing cached yet)", () => {
  disposeCacheAwareness("s1");
  assert.equal(noteSendAndCheckCold("s1", "anthropic", 0), null);
});

test("warns when the gap exceeds the 5-min TTL", () => {
  disposeCacheAwareness("s2");
  noteSendAndCheckCold("s2", "anthropic", 0);
  const warn = noteSendAndCheckCold("s2", "anthropic", FIVE_MIN + 1000);
  assert.match(warn ?? "", /cold/i);
});

test("gap just under TTL stays warm, over TTL goes cold", () => {
  disposeCacheAwareness("s3");
  noteSendAndCheckCold("s3", "anthropic", 0);
  assert.equal(noteSendAndCheckCold("s3", "anthropic", FIVE_MIN - 1), null); // warm
  // last send was at FIVE_MIN-1; now jump well past TTL
  const warn = noteSendAndCheckCold("s3", "anthropic", FIVE_MIN - 1 + FIVE_MIN + 5000);
  assert.match(warn ?? "", /cold/i);
});

test("non-caching providers never warn", () => {
  disposeCacheAwareness("s4");
  noteSendAndCheckCold("s4", "openai", 0);
  assert.equal(noteSendAndCheckCold("s4", "openai", 10 * FIVE_MIN), null);
});

test("summarizeCache computes hit ratio", () => {
  const s = summarizeCache({
    inputTokens: 100,
    cacheReadInputTokens: 900,
    cacheCreationInputTokens: 50,
  });
  assert.equal(s.readTokens, 900);
  assert.equal(s.writeTokens, 50);
  assert.equal(s.hitRatio, 0.9); // 900 / (900 + 100)
});

test("summarizeCache handles missing usage", () => {
  const s = summarizeCache(undefined);
  assert.deepEqual([s.readTokens, s.writeTokens, s.hitRatio], [0, 0, 0]);
});

test("the cold line follows FREECODE_CACHE_TTL", () => {
  const prev = process.env.FREECODE_CACHE_TTL;
  process.env.FREECODE_CACHE_TTL = "1h";
  try {
    // A 10-minute gap is cold at the 5m default but warm at 1h. Warning here
    // would send the user chasing a miss that never happened.
    disposeCacheAwareness("ttl1");
    noteSendAndCheckCold("ttl1", "anthropic", 0);
    assert.equal(noteSendAndCheckCold("ttl1", "anthropic", 10 * FIVE_MIN), null);

    disposeCacheAwareness("ttl2");
    noteSendAndCheckCold("ttl2", "anthropic", 0);
    const warn = noteSendAndCheckCold("ttl2", "anthropic", 70 * 60 * 1000);
    assert.match(warn ?? "", /cold/i);
    assert.match(warn ?? "", /1h TTL/);
    // Already on the long TTL — nothing left to suggest.
    assert.doesNotMatch(warn ?? "", /FREECODE_CACHE_TTL=1h/);
  } finally {
    if (prev === undefined) delete process.env.FREECODE_CACHE_TTL;
    else process.env.FREECODE_CACHE_TTL = prev;
  }
});

test("the 5m warning points at the 1h knob", () => {
  disposeCacheAwareness("ttl3");
  noteSendAndCheckCold("ttl3", "anthropic", 0);
  const warn = noteSendAndCheckCold("ttl3", "anthropic", 10 * FIVE_MIN);
  assert.match(warn ?? "", /FREECODE_CACHE_TTL=1h/);
});
