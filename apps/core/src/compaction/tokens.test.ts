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
