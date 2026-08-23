import test from "node:test";
import assert from "node:assert/strict";
import {
  aggregate,
  ndcgAtK,
  precisionAtK,
  recallAtK,
  reciprocalRank,
} from "./metrics.js";

// Five-document fixture, hand-computed. The harness judges every later phase,
// so its arithmetic is pinned before it is trusted (plan Phase 0.4).
const RANKED = ["a", "b", "c", "d", "e"];
const GOLD = ["b", "e", "z"]; // z is never retrieved

const close = (actual: number, expected: number, what: string) =>
  assert.ok(
    Math.abs(actual - expected) < 1e-9,
    `${what}: got ${actual}, want ${expected}`,
  );

test("recall@k counts hits over gold size, not over k", () => {
  close(recallAtK(RANKED, GOLD, 5), 2 / 3, "recall@5"); // b, e found of 3 gold
  close(recallAtK(RANKED, GOLD, 2), 1 / 3, "recall@2"); // only b in top 2
  close(recallAtK(RANKED, [], 5), 0, "no gold");
});

test("precision@k divides by k, so a short result list is penalised", () => {
  close(precisionAtK(RANKED, GOLD, 5), 2 / 5, "precision@5");
  close(precisionAtK(["b"], GOLD, 5), 1 / 5, "one correct hit of five asked");
  close(precisionAtK([], GOLD, 5), 0, "empty result");
});

test("reciprocal rank is 1/position of the first hit", () => {
  close(reciprocalRank(RANKED, GOLD), 1 / 2, "b at position 2");
  close(reciprocalRank(RANKED, ["a"]), 1, "hit at position 1");
  close(reciprocalRank(RANKED, ["z"]), 0, "no hit");
});

test("nDCG@10 is 1 when all gold ranks first, and discounts by position", () => {
  close(ndcgAtK(["b", "e"], ["b", "e"], 10), 1, "perfect ordering");
  // DCG = 1/log2(3) + 1/log2(6); IDCG = 1/log2(2) + 1/log2(3) + 1/log2(4)
  const dcg = 1 / Math.log2(3) + 1 / Math.log2(6);
  const idcg = 1 / Math.log2(2) + 1 / Math.log2(3) + 1 / Math.log2(4);
  close(ndcgAtK(RANKED, GOLD, 10), dcg / idcg, "positional discount");
});

test("aggregate scores abstention queries separately from the rest", () => {
  const m = aggregate([
    { query: "hit", ranked: ["b"], relevant: ["b"] },
    { query: "miss", ranked: ["a"], relevant: ["b"] },
    { query: "abstain-ok", ranked: [], relevant: [] },
    { query: "abstain-bad", ranked: ["a", "b"], relevant: [] },
  ]);

  assert.equal(m.queries, 2, "abstention queries excluded from the scored set");
  assert.equal(m.abstentionQueries, 2);
  close(m.recallAt5, 0.5, "one of two scored queries recalled");
  close(m.abstentionAccuracy, 0.5, "one of two abstentions returned nothing");
});

test("an all-abstention run does not divide by zero", () => {
  const m = aggregate([{ query: "q", ranked: [], relevant: [] }]);
  assert.equal(m.queries, 0);
  close(m.recallAt5, 0, "no scored queries averages to 0, not NaN");
  close(m.abstentionAccuracy, 1, "the abstention was correct");
});
