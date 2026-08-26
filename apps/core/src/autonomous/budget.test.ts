import test from "node:test";
import assert from "node:assert/strict";
import {
  addUsage,
  billedTokens,
  budgetExceeded,
  budgetUsage,
} from "./budget.js";
import { DEFAULT_RUN_LIMITS, EMPTY_USAGE, type RunUsage } from "./types.js";

const limits = { ...DEFAULT_RUN_LIMITS, maxUsd: 5 };

function usage(over: Partial<RunUsage> = {}): RunUsage {
  return { ...EMPTY_USAGE, ...over };
}

const healthy = {
  limits,
  usage: usage(),
  turns: 0,
  elapsedMs: 0,
};

test("a run inside every ceiling continues", () => {
  assert.equal(budgetExceeded(healthy), undefined);
});

// ---------------------------------------------------------------------------
// All four ceilings, each in isolation.
// ---------------------------------------------------------------------------

test("the turn ceiling stops the run", () => {
  assert.equal(
    budgetExceeded({ ...healthy, turns: limits.maxTurns }),
    "budget_turns",
  );
  assert.equal(
    budgetExceeded({ ...healthy, turns: limits.maxTurns - 1 }),
    undefined,
    "the last permitted turn still runs",
  );
});

test("the token ceiling stops the run", () => {
  assert.equal(
    budgetExceeded({
      ...healthy,
      usage: usage({ inputTokens: limits.maxTokens }),
    }),
    "budget_tokens",
  );
});

test("the time ceiling stops the run", () => {
  assert.equal(
    budgetExceeded({ ...healthy, elapsedMs: limits.timeoutMs }),
    "budget_time",
  );
});

test("the usd ceiling stops the run", () => {
  assert.equal(
    budgetExceeded({ ...healthy, usage: usage({ usd: 5 }) }),
    "budget_usd",
  );
});

test("no maxUsd configured means cost cannot stop the run", () => {
  const noUsd = { ...limits, maxUsd: undefined };
  assert.equal(
    budgetExceeded({ ...healthy, limits: noUsd, usage: usage({ usd: 9999 }) }),
    undefined,
  );
});

test("usd is not enforced until the provider reports a cost", () => {
  assert.equal(
    budgetExceeded({ ...healthy, usage: usage({ usd: undefined }) }),
    undefined,
    "an unpriced run is not a free one, but it is not a stoppable one either",
  );
});

// ---------------------------------------------------------------------------
// First one wins, in a fixed order.
// ---------------------------------------------------------------------------

test("whichever ceiling is hit first wins, in the documented order", () => {
  const everything = {
    limits,
    usage: usage({ inputTokens: 10_000_000, usd: 500 }),
    turns: 9999,
    elapsedMs: 10 * 60 * 60 * 1000,
  };
  assert.equal(budgetExceeded(everything), "budget_turns");

  // Remove the turn ceiling and the next one in order reports.
  assert.equal(budgetExceeded({ ...everything, turns: 0 }), "budget_tokens");
  assert.equal(
    budgetExceeded({ ...everything, turns: 0, usage: usage({ usd: 500 }) }),
    "budget_time",
  );
  assert.equal(
    budgetExceeded({
      ...everything,
      turns: 0,
      elapsedMs: 0,
      usage: usage({ usd: 500 }),
    }),
    "budget_usd",
  );
});

// ---------------------------------------------------------------------------
// The cache-read exclusion — §4.3, the load-bearing rule.
// ---------------------------------------------------------------------------

test("cache reads do not count toward the token ceiling", () => {
  // A long, healthy, well-cached run: every turn re-sends the conversation and
  // reads it from cache. Counting that cumulatively would stop the run for
  // doing exactly what the caching work was for.
  const heavilyCached = usage({
    inputTokens: 1_000,
    outputTokens: 500,
    cacheWriteTokens: 200,
    cacheReadTokens: 50_000_000,
  });

  assert.equal(billedTokens(heavilyCached), 1_700);
  assert.equal(
    budgetExceeded({ ...healthy, usage: heavilyCached }),
    undefined,
    "50M cache reads must not exhaust a 150K budget",
  );
});

test("cache writes DO count — they are billed and they are new", () => {
  const usage_ = usage({ cacheWriteTokens: limits.maxTokens });
  assert.equal(billedTokens(usage_), limits.maxTokens);
  assert.equal(budgetExceeded({ ...healthy, usage: usage_ }), "budget_tokens");
});

// ---------------------------------------------------------------------------
// Mutation check (§7). These assert the tests above would FAIL if the
// implementation were broken in the specific ways it is likeliest to break —
// "passes for the wrong reason" is the failure the v0.20.0 postmortem calls out.
// ---------------------------------------------------------------------------

test("MUTATION: folding cache reads into the total would trip the ceiling", () => {
  const heavilyCached = usage({
    inputTokens: 1_000,
    cacheReadTokens: 50_000_000,
  });
  // The mutant: `billedTokens` also adds cacheReadTokens.
  const mutantTotal =
    billedTokens(heavilyCached) + heavilyCached.cacheReadTokens;

  assert.ok(
    mutantTotal >= limits.maxTokens,
    "if this does not exceed the cap, the cache-read test above proves nothing",
  );
  assert.ok(
    billedTokens(heavilyCached) < limits.maxTokens,
    "and the real implementation must stay under it",
  );
});

test("MUTATION: a `>` instead of `>=` would let every ceiling overrun by one", () => {
  // Exactly at the limit must stop. A `>` mutant returns undefined here, so
  // this case is what makes the boundary tests load-bearing rather than
  // decorative.
  assert.equal(
    budgetExceeded({ ...healthy, turns: limits.maxTurns }),
    "budget_turns",
  );
  assert.equal(
    budgetExceeded({
      ...healthy,
      usage: usage({ inputTokens: limits.maxTokens }),
    }),
    "budget_tokens",
  );
  assert.equal(
    budgetExceeded({ ...healthy, elapsedMs: limits.timeoutMs }),
    "budget_time",
  );
  assert.equal(
    budgetExceeded({ ...healthy, usage: usage({ usd: limits.maxUsd }) }),
    "budget_usd",
  );
});

// ---------------------------------------------------------------------------
// Reporting helpers.
// ---------------------------------------------------------------------------

test("budgetUsage reports a fraction of each configured ceiling", () => {
  const fractions = budgetUsage({
    limits,
    usage: usage({ inputTokens: 75_000, usd: 1 }),
    turns: 10,
    elapsedMs: limits.timeoutMs / 4,
  });
  assert.equal(fractions.turns, 0.5);
  assert.equal(fractions.tokens, 0.5);
  assert.equal(fractions.time, 0.25);
  assert.equal(fractions.usd, 0.2);
});

test("budgetUsage omits usd when no cost ceiling is set", () => {
  const fractions = budgetUsage({
    ...healthy,
    limits: { ...limits, maxUsd: undefined },
  });
  assert.ok(!("usd" in fractions));
});

test("addUsage accumulates, and keeps cache reads separate", () => {
  let total = EMPTY_USAGE;
  total = addUsage(total, { inputTokens: 100, cacheReadTokens: 900 });
  total = addUsage(total, { inputTokens: 50, outputTokens: 20 });

  assert.equal(total.inputTokens, 150);
  assert.equal(total.outputTokens, 20);
  assert.equal(total.cacheReadTokens, 900);
  assert.equal(billedTokens(total), 170);
});

test("addUsage leaves usd absent until something reports one", () => {
  assert.equal(addUsage(EMPTY_USAGE, { inputTokens: 1 }).usd, undefined);
  assert.equal(addUsage(EMPTY_USAGE, { usd: 0.5 }).usd, 0.5);
});
