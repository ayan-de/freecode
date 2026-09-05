import test from "node:test";
import assert from "node:assert/strict";
import { priceUsd } from "./price.js";

test("an unknown model prices as undefined, never as zero", () => {
  assert.equal(
    priceUsd("mystery-model", {
      inputTokens: 1_000_000,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    }),
    undefined,
  );
});

test("MiniMax-M3: 1M plain input is $0.30, 1M output is $1.20", () => {
  assert.equal(
    priceUsd("MiniMax-M3", {
      inputTokens: 1_000_000,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    }),
    0.3,
  );
  assert.equal(
    priceUsd("minimax/MiniMax-M3", {
      inputTokens: 0,
      outputTokens: 1_000_000,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    }),
    1.2,
  );
});

test("a cache read is a discount off inclusive input, not an addend", () => {
  // 1M input of which 800k is a cache read: 200k × $0.30 + 800k × $0.06 = $0.108
  assert.equal(
    priceUsd("MiniMax-M3", {
      inputTokens: 1_000_000,
      outputTokens: 0,
      cacheReadTokens: 800_000,
      cacheWriteTokens: 0,
    }),
    0.108,
  );
});
