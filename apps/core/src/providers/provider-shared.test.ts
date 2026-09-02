import test from "node:test";
import assert from "node:assert/strict";
import {
  safe,
  sumTokens,
  subtractTokens,
  totalTokens,
  visibleOutputTokens,
  mapUsage,
} from "./provider-shared.js";

test("safe clamps", () => {
  assert.equal(safe(undefined), 0);
  assert.equal(safe(NaN), 0);
  assert.equal(safe(-10), 0);
  assert.equal(safe(5), 5);
});

test("subtractTokens returns undefined when total is undefined", () => {
  assert.equal(subtractTokens(undefined, 5), undefined);
  assert.equal(subtractTokens(undefined, undefined), undefined);
});

test("subtractTokens returns total when subtrahend is undefined", () => {
  assert.equal(subtractTokens(10, undefined), 10);
});

test("subtractTokens clamps at 0", () => {
  assert.equal(subtractTokens(5, 10), 0);
  assert.equal(subtractTokens(100, 50), 50);
});

test("sumTokens returns undefined when every value is undefined", () => {
  assert.equal(sumTokens(undefined, undefined), undefined);
});

test("sumTokens sums non-zero values", () => {
  assert.equal(sumTokens(10, 20, 30), 60);
  assert.equal(sumTokens(10, undefined, 5), 15);
});

test("totalTokens prefers a provider-supplied total", () => {
  assert.equal(totalTokens(10, 20, 999), 999);
  assert.equal(totalTokens(undefined, undefined, 999), 999);
});

test("totalTokens falls back to input + output when total is undefined", () => {
  assert.equal(totalTokens(10, 20, undefined), 30);
  assert.equal(totalTokens(7, undefined, undefined), 7);
  assert.equal(totalTokens(undefined, 8, undefined), 8);
});

test("totalTokens returns undefined when nothing is known", () => {
  assert.equal(totalTokens(undefined, undefined, undefined), undefined);
});

test("visibleOutputTokens returns output when reasoning is undefined", () => {
  assert.equal(visibleOutputTokens(100, undefined), 100);
});

test("visibleOutputTokens clamps at 0 when reasoning exceeds output", () => {
  assert.equal(visibleOutputTokens(50, 100), 0);
});

test("visibleOutputTokens returns undefined when output is undefined", () => {
  assert.equal(visibleOutputTokens(undefined, 5), undefined);
  assert.equal(visibleOutputTokens(undefined, undefined), undefined);
});

// --- mapUsage ------------------------------------------------------------

test("mapUsage returns undefined for undefined input", () => {
  assert.equal(mapUsage(undefined), undefined);
});

test("mapUsage carries the inclusive input total + breakdown the SDK hands us", () => {
  // The Anthropic adapter normalizes its wire payload into:
  //   inputTokens: total = input_tokens + cache_creation + cache_read
  //   inputTokenDetails: { noCache, cacheRead, cacheWrite }
  const out = mapUsage({
    inputTokens: 1050, // 100 non-cached + 50 cache_write + 900 cache_read
    outputTokens: 200,
    inputTokenDetails: { noCacheTokens: 100, cacheReadTokens: 900, cacheWriteTokens: 50 },
    totalTokens: 1250,
  });
  assert.deepEqual(out, {
    inputTokens: 1050,
    outputTokens: 200,
    nonCachedInputTokens: 100,
    cacheReadInputTokens: 900,
    cacheWriteInputTokens: 50,
    totalTokens: 1250,
  });
});

test("mapUsage preserves reasoning tokens for OpenAI Responses / Gemini", () => {
  const out = mapUsage({
    inputTokens: 1000,
    outputTokens: 200,
    inputTokenDetails: { cacheReadTokens: 900, cacheWriteTokens: 0 },
    outputTokenDetails: { reasoningTokens: 30, textTokens: 170 },
    totalTokens: 1200,
  });
  assert.equal(out?.inputTokens, 1000);
  assert.equal(out?.nonCachedInputTokens, 100);
  assert.equal(out?.reasoningTokens, 30);
  assert.equal(out?.outputTokens, 200);
  assert.equal(out?.totalTokens, 1200);
});

test("mapUsage clamps a nonsensical breakdown (cached > prompt)", () => {
  const out = mapUsage({
    inputTokens: 100,
    inputTokenDetails: { cacheReadTokens: 500, cacheWriteTokens: 100 },
  });
  // Inclusive total stays the SDK's value (the SDK is the source of truth).
  assert.equal(out?.inputTokens, 100);
  // Non-cached would be negative; clamped to 0.
  assert.equal(out?.nonCachedInputTokens, 0);
});

test("mapUsage derives nonCachedInputTokens by subtraction when SDK omits it", () => {
  const out = mapUsage({
    inputTokens: 1000,
    inputTokenDetails: { cacheReadTokens: 900, cacheWriteTokens: 0 },
  });
  assert.equal(out?.nonCachedInputTokens, 100);
});

test("mapUsage falls back to the deprecated v5 cachedInputTokens", () => {
  const out = mapUsage({
    inputTokens: 100,
    cachedInputTokens: 70,
  });
  assert.equal(out?.cacheReadInputTokens, 70);
  assert.equal(out?.cacheWriteInputTokens, undefined);
});

test("mapUsage falls back to the deprecated v5 reasoningTokens", () => {
  const out = mapUsage({
    inputTokens: 10,
    outputTokens: 100,
    reasoningTokens: 30,
  });
  assert.equal(out?.reasoningTokens, 30);
});

test("mapUsage takes anthropic cacheCreationInputTokens when the SDK reports cacheWriteTokens as 0", () => {
  // @ai-sdk/anthropic does `cache_creation_input_tokens ?? 0`, so a MiniMax
  // (or Anthropic) stream that only fills providerMetadata looks like a
  // zero write. opencode's getUsage reads the metadata; so do we.
  const out = mapUsage(
    {
      inputTokens: 1150,
      inputTokenDetails: { cacheReadTokens: 900, cacheWriteTokens: 0 },
    },
    { anthropic: { cacheCreationInputTokens: 250 } },
  );
  assert.equal(out?.cacheWriteInputTokens, 250);
});

test("mapUsage prefers a real inputTokenDetails.cacheWriteTokens over metadata", () => {
  const out = mapUsage(
    {
      inputTokens: 1050,
      inputTokenDetails: { cacheReadTokens: 900, cacheWriteTokens: 50 },
    },
    { anthropic: { cacheCreationInputTokens: 999 } },
  );
  assert.equal(out?.cacheWriteInputTokens, 50);
});

test("mapUsage sums nested cache_creation ephemeral buckets when the top-level field is missing", () => {
  const out = mapUsage(
    { inputTokens: 5752, inputTokenDetails: { cacheWriteTokens: 0 } },
    {
      anthropic: {
        usage: {
          cache_creation: {
            ephemeral_5m_input_tokens: 4000,
            ephemeral_1h_input_tokens: 1752,
          },
        },
      },
    },
  );
  assert.equal(out?.cacheWriteInputTokens, 5752);
});

test("mapUsage preserves providerMetadata", () => {
  const meta = { openai: { prompt_cache_key: "abc" } };
  const out = mapUsage({ inputTokens: 10, outputTokens: 5 }, meta);
  assert.deepEqual(out?.providerMetadata, meta);
});

test("mapUsage survives a partial payload (only output)", () => {
  const out = mapUsage({ outputTokens: 7 });
  assert.equal(out?.outputTokens, 7);
  assert.equal(out?.totalTokens, 7);
});

test("mapUsage survives a fully empty payload", () => {
  assert.deepEqual(mapUsage({}), {});
});

test("mapUsage computes totalTokens as input + output when SDK omits it", () => {
  const out = mapUsage({ inputTokens: 10, outputTokens: 5 });
  assert.equal(out?.totalTokens, 15);
});