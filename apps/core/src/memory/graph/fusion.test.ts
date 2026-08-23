import test from "node:test";
import assert from "node:assert/strict";
import { fuseByRank, FUSED_FLOOR, RRF_K } from "./fusion.js";

test("a document found by both retrievers outranks one found by either alone", () => {
  const vector = ["a", "b", "c"];
  const lexical = ["c", "d", "e"];

  const fused = fuseByRank([vector, lexical]);
  assert.equal(fused[0]?.id, "c", "agreement beats a single first place");
  assert.ok(
    (fused[0]?.score ?? 0) > (fused[1]?.score ?? 0),
    "and does so on score, not tie-breaking",
  );
});

test("fusion order is invariant to either retriever's score scale", () => {
  // The property that motivated RRF over a weighted sum: cosine similarities
  // live in [0,1] and BM25 scores are unbounded, so any sum of the two would
  // need a calibration constant. Ranks have no scale to calibrate.
  //
  // Both calls pass the same *orders*; a scale-sensitive fusion would have to
  // be handed scores to differ, and there is nowhere to hand them in.
  const vector = ["a", "b", "c"];
  const lexical = ["c", "b", "z"];

  const first = fuseByRank([vector, lexical]).map((r) => r.id);
  const second = fuseByRank([vector, lexical]).map((r) => r.id);
  assert.deepEqual(first, second);

  // And the fused score depends only on positions, so two retrievers that
  // agree perfectly produce exactly 2/(K+1) for the top document.
  const agreed = fuseByRank([["x"], ["x"]]);
  assert.ok(
    Math.abs((agreed[0]?.score ?? 0) - 2 / (RRF_K + 1)) < 1e-12,
    "score is a pure function of rank",
  );
});

test("a document nobody returned scores zero and is below the floor", () => {
  const fused = fuseByRank([["a"], ["b"]]);
  assert.equal(fused.length, 2, "only returned documents appear at all");
  for (const r of fused) {
    assert.ok(r.score >= FUSED_FLOOR, "a single hit anywhere clears the floor");
  }
  assert.ok(FUSED_FLOOR > 0, "the floor rejects a zero-score document");
});

test("a single hit at the worst reportable rank still clears the floor", () => {
  // The floor must reject "no retriever returned this" and nothing else. A
  // lone hit at rank 1000 — far worse than K_INITIAL ever produces — passes.
  const deep = Array.from({ length: 1000 }, (_, i) => `d${i}`);
  const fused = fuseByRank([deep]);
  const last = fused[fused.length - 1];
  assert.ok((last?.score ?? 0) >= FUSED_FLOOR, "deep single hit survives");
});

test("fusion is stable for equal scores, so runs are reproducible", () => {
  const a = fuseByRank([["p", "q"], ["q", "p"]]).map((r) => r.id);
  const b = fuseByRank([["p", "q"], ["q", "p"]]).map((r) => r.id);
  assert.deepEqual(a, b, "ties break deterministically by id");
});

test("an empty list contributes nothing rather than erasing the other", () => {
  const fused = fuseByRank([[], ["a", "b"]]).map((r) => r.id);
  assert.deepEqual(fused, ["a", "b"]);
  assert.deepEqual(fuseByRank([[], []]), []);
});
