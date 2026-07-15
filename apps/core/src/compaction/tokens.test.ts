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

test("getContextLimit falls back for unknown models", () => {
  assert.equal(getContextLimit("unknown-model"), 100_000);
});

test("getAutoCompactThreshold reserves compaction buffer", () => {
  assert.equal(getAutoCompactThreshold("gpt-4o", 13_000), 115_000);
});

test("shouldCompact is only true at or above threshold", () => {
  assert.equal(shouldCompact(114_999, "gpt-4o", 13_000), false);
  assert.equal(shouldCompact(115_000, "gpt-4o", 13_000), true);
});
