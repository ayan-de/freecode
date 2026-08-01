import test from "node:test";
import assert from "node:assert/strict";
import {
  estimateTokenCount,
  getContextLimit,
  getAutoCompactThreshold,
  shouldCompact,
} from "./tokens.js";

test("estimateTokenCount uses a conservative char estimate", () => {
  assert.equal(estimateTokenCount("Hello World"), 3);
});

test("getContextLimit returns the offline fallback floor", () => {
  assert.equal(getContextLimit("unknown-model"), 100_000);
  assert.equal(getContextLimit("gpt-4o"), 100_000);
});

test("getAutoCompactThreshold reserves compaction buffer", () => {
  assert.equal(getAutoCompactThreshold("gpt-4o", 13_000), 87_000);
});

test("shouldCompact uses the fallback limit when no explicit limit is given", () => {
  assert.equal(shouldCompact(86_999, "gpt-4o", 13_000), false);
  assert.equal(shouldCompact(87_000, "gpt-4o", 13_000), true);
});

test("shouldCompact prefers an explicit (models.dev) context limit", () => {
  // 200K model with a 13K buffer → threshold 187K, not the 87K fallback.
  assert.equal(shouldCompact(150_000, "gpt-4o", 13_000, 200_000), false);
  assert.equal(shouldCompact(187_000, "gpt-4o", 13_000, 200_000), true);
});

test("FREECODE_AUTO_COMPACT_TOKENS overrides the threshold for testing", () => {
  const original = process.env.FREECODE_AUTO_COMPACT_TOKENS;
  try {
    // Without it, 20k against a 1M window is nowhere near the threshold.
    delete process.env.FREECODE_AUTO_COMPACT_TOKENS;
    assert.equal(shouldCompact(20_000, "MiniMax-M3", 13_000, 1_000_000), false);

    // With it, the same count fires.
    process.env.FREECODE_AUTO_COMPACT_TOKENS = "15000";
    assert.equal(shouldCompact(20_000, "MiniMax-M3", 13_000, 1_000_000), true);
    assert.equal(shouldCompact(14_999, "MiniMax-M3", 13_000, 1_000_000), false);
  } finally {
    if (original === undefined) delete process.env.FREECODE_AUTO_COMPACT_TOKENS;
    else process.env.FREECODE_AUTO_COMPACT_TOKENS = original;
  }
});

test("an unusable FREECODE_AUTO_COMPACT_TOKENS is ignored, not obeyed", () => {
  const original = process.env.FREECODE_AUTO_COMPACT_TOKENS;
  try {
    // A typo must not disable compaction or force it on every turn.
    for (const bad of ["", "abc", "0", "-5"]) {
      process.env.FREECODE_AUTO_COMPACT_TOKENS = bad;
      assert.equal(
        shouldCompact(20_000, "MiniMax-M3", 13_000, 1_000_000),
        false,
        `bad value ${JSON.stringify(bad)} should fall back to the real threshold`,
      );
    }
  } finally {
    if (original === undefined) delete process.env.FREECODE_AUTO_COMPACT_TOKENS;
    else process.env.FREECODE_AUTO_COMPACT_TOKENS = original;
  }
});
