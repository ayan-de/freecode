// =============================================================================
// Reciprocal rank fusion (spec D1).
//
// Combines several ranked candidate lists into one. Reads only *positions*,
// never scores — which is the whole reason it is used here: a cosine similarity
// in [0,1] and an unbounded BM25 score cannot be summed without inventing a
// calibration constant, and any such constant would be a hidden tuning knob
// nobody ever revisits.
//
//   rrf(d) = Σ_r  1 / (RRF_K + rank_r(d))
//
// A document found by both retrievers outranks one found by either alone,
// without either retriever's scale mattering.
// =============================================================================

import type { RetrievalResult } from "./graph-types.js";

// Standard value from the original RRF paper. Large enough that the difference
// between rank 1 and rank 2 does not dominate agreement between retrievers.
export const RRF_K = 60;

// Minimum fused score for a candidate to seed the cascade. One retriever
// ranking something last still clears this; the floor exists to reject the case
// where *no* retriever returned the document at all, which after fusion is a
// score of exactly 0.
//
// It is expressed relative to RRF_K so the two constants cannot drift apart:
// a single hit at rank K_INITIAL (the worst possible position a retriever can
// report) must still pass.
export const FUSED_FLOOR = 1 / (RRF_K + 1000);

export function fuseByRank(
  rankedLists: string[][],
  k: number = RRF_K,
): RetrievalResult[] {
  const scores = new Map<string, number>();
  for (const list of rankedLists) {
    list.forEach((id, i) => {
      scores.set(id, (scores.get(id) ?? 0) + 1 / (k + i + 1));
    });
  }
  return [...scores.entries()]
    .map(([id, score]) => ({ id, score }))
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
}
