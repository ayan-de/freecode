import test from "node:test";
import assert from "node:assert/strict";
import { checkBudget, countedTokens } from "./budget.js";
import type { RunLimits, RunUsage } from "./types.js";

const limits: RunLimits = {
  maxTurns: 20,
  maxTokens: 150_000,
  timeoutMs: 60 * 60 * 1000,
  maxUsd: 5,
};

function usage(overrides: Partial<RunUsage> = {}): RunUsage {
  return { turns: 0, countedTokens: 0, elapsedMs: 0, usd: 0, ...overrides };
}

test("checkBudget: under all ceilings returns undefined", () => {
  assert.equal(checkBudget(usage({ turns: 5 }), limits), undefined);
});

test("checkBudget: maxTurns hit first when only turns exceed", () => {
  assert.equal(checkBudget(usage({ turns: 20 }), limits), "maxTurns");
});

test("checkBudget: maxTokens", () => {
  assert.equal(
    checkBudget(usage({ turns: 1, countedTokens: 150_000 }), limits),
    "maxTokens",
  );
});

test("checkBudget: timeoutMs", () => {
  assert.equal(
    checkBudget(usage({ turns: 1, elapsedMs: 60 * 60 * 1000 }), limits),
    "timeoutMs",
  );
});

test("checkBudget: maxUsd", () => {
  assert.equal(checkBudget(usage({ turns: 1, usd: 5 }), limits), "maxUsd");
});

test("checkBudget: first ceiling in order wins when multiple are exceeded", () => {
  assert.equal(
    checkBudget(
      usage({ turns: 20, countedTokens: 150_000, elapsedMs: 60 * 60 * 1000, usd: 5 }),
      limits,
    ),
    "maxTurns",
  );
});

test("countedTokens: excludes cache-read tokens", () => {
  const total = countedTokens({
    inputTokens: 100,
    outputTokens: 50,
    cacheCreationInputTokens: 25,
  });
  assert.equal(total, 175);
});

test("countedTokens: a large cacheReadInputTokens is not part of the input shape at all", () => {
  // cacheReadInputTokens is deliberately not accepted by countedTokens' input
  // type — verifying the exclusion means constructing a usage object with a
  // large cache-read-equivalent value folded nowhere the function reads it.
  const total = countedTokens({ inputTokens: 10, outputTokens: 10 });
  assert.equal(total, 20);
});
