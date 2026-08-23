// =============================================================================
// Recall metrics for the memory benchmark (spec D14).
//
// Pure functions over (ranked ids, gold ids). No I/O, no store, no embedder —
// so they can be tested against hand-computed values, which matters because
// every later phase is judged by the numbers this file produces.
//
// Abstention queries (gold = []) are scored separately: recall/precision/MRR
// /nDCG are undefined when nothing is relevant, and averaging a 0 into them
// would make "correctly returned nothing" look like a retrieval failure.
// =============================================================================

export interface BenchQueryResult {
  query: string;
  ranked: string[]; // retrieved ids, best first
  relevant: string[]; // gold ids; [] marks an abstention case
}

export interface BenchMetrics {
  queries: number; // scored (non-abstention) queries
  abstentionQueries: number;
  recallAt5: number;
  recallAt10: number;
  precisionAt5: number;
  mrr: number;
  ndcgAt10: number;
  // Fraction of abstention queries that correctly returned nothing. This is
  // the number defect 3 shows up as; expect ~0 before D1 and ~1 after.
  abstentionAccuracy: number;
}

export function recallAtK(
  ranked: string[],
  relevant: string[],
  k: number,
): number {
  if (relevant.length === 0) return 0;
  const gold = new Set(relevant);
  const hits = ranked.slice(0, k).filter((id) => gold.has(id)).length;
  return hits / relevant.length;
}

export function precisionAtK(
  ranked: string[],
  relevant: string[],
  k: number,
): number {
  if (k === 0) return 0;
  const gold = new Set(relevant);
  const window = ranked.slice(0, k);
  if (window.length === 0) return 0;
  // Divide by k, not by window.length: returning 2 correct results when 5 were
  // asked for is not the same as returning 2 of 2, and the former is what a
  // truncating retriever does.
  return window.filter((id) => gold.has(id)).length / k;
}

// Reciprocal rank of the first relevant result, 0 if none in the list.
export function reciprocalRank(ranked: string[], relevant: string[]): number {
  const gold = new Set(relevant);
  const idx = ranked.findIndex((id) => gold.has(id));
  return idx === -1 ? 0 : 1 / (idx + 1);
}

// Binary-gain nDCG: DCG = Σ rel_i / log2(i + 1), ideal = all relevant on top.
export function ndcgAtK(
  ranked: string[],
  relevant: string[],
  k: number,
): number {
  if (relevant.length === 0) return 0;
  const gold = new Set(relevant);
  let dcg = 0;
  ranked.slice(0, k).forEach((id, i) => {
    if (gold.has(id)) dcg += 1 / Math.log2(i + 2);
  });
  let idcg = 0;
  for (let i = 0; i < Math.min(relevant.length, k); i++) {
    idcg += 1 / Math.log2(i + 2);
  }
  return idcg === 0 ? 0 : dcg / idcg;
}

const mean = (xs: number[]): number =>
  xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length;

export function aggregate(results: BenchQueryResult[]): BenchMetrics {
  const scored = results.filter((r) => r.relevant.length > 0);
  const abstain = results.filter((r) => r.relevant.length === 0);

  return {
    queries: scored.length,
    abstentionQueries: abstain.length,
    recallAt5: mean(scored.map((r) => recallAtK(r.ranked, r.relevant, 5))),
    recallAt10: mean(scored.map((r) => recallAtK(r.ranked, r.relevant, 10))),
    precisionAt5: mean(scored.map((r) => precisionAtK(r.ranked, r.relevant, 5))),
    mrr: mean(scored.map((r) => reciprocalRank(r.ranked, r.relevant))),
    ndcgAt10: mean(scored.map((r) => ndcgAtK(r.ranked, r.relevant, 10))),
    abstentionAccuracy: mean(abstain.map((r) => (r.ranked.length === 0 ? 1 : 0))),
  };
}

const pct = (n: number): string => `${(n * 100).toFixed(1)}%`;

export function formatMetrics(m: BenchMetrics, label = "current"): string {
  return [
    `| metric | ${label} |`,
    `| --- | ---: |`,
    `| recall@5 | ${pct(m.recallAt5)} |`,
    `| recall@10 | ${pct(m.recallAt10)} |`,
    `| precision@5 | ${pct(m.precisionAt5)} |`,
    `| MRR | ${pct(m.mrr)} |`,
    `| nDCG@10 | ${pct(m.ndcgAt10)} |`,
    `| abstention accuracy | ${pct(m.abstentionAccuracy)} |`,
    ``,
    `${m.queries} scored queries, ${m.abstentionQueries} abstention queries.`,
  ].join("\n");
}
