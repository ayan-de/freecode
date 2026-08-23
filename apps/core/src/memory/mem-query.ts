// =============================================================================
// Memory Query - Find relevant memories for a query
// Lexical relevance via BM25 (spec D1). No LLM, no embeddings.
//
// This path serves two callers with different needs:
//   - `findRelevantMemories` — entry list, used by `memory.query` (IPC) and as
//     the embedder-unavailable fallback (KG spec D6).
//   - `rankRelevantMemories` — ids + rank, consumed by the graph service's
//     rank fusion, which needs positions rather than entries or scores.
// =============================================================================

import type { MemoryEntry, MemoryQueryOptions } from "./mem-types.js";
import { MemoryStore } from "./mem-store.js";
import { Bm25Index } from "./bm25.js";

export interface RankedMemory {
  id: string; // `${type}/${name}`
  rank: number; // 1-based position, best first
  score: number;
}

function candidates(store: MemoryStore, options: MemoryQueryOptions): MemoryEntry[] {
  const { types } = options;
  const entries = store.list();
  return types && types.length > 0
    ? entries.filter((e) => types.includes(e.type))
    : entries;
}

// Rank memories lexically. Returns positions, not scores, because the fusion
// step downstream (RRF) reads only ranks — deliberately, since BM25 scores and
// cosine similarities are not on comparable scales.
export function rankRelevantMemories(
  query: string,
  store: MemoryStore,
  options: MemoryQueryOptions = {},
): RankedMemory[] {
  const { limit = 5 } = options;
  const entries = candidates(store, options);
  if (entries.length === 0 || query.trim().length === 0) return [];

  const index = new Bm25Index(entries);
  return index
    .search(query, limit)
    .map((hit, i) => ({ id: hit.id, rank: i + 1, score: hit.score }));
}

export function findRelevantMemories(
  query: string,
  store: MemoryStore,
  options: MemoryQueryOptions = {},
): MemoryEntry[] {
  const { limit = 5 } = options;
  const entries = candidates(store, options);

  // Blank query: there is nothing to score against, so return the first N
  // honestly rather than letting a degenerate scorer impose an order.
  if (query.trim().length === 0) return entries.slice(0, limit);

  const byId = new Map(entries.map((e) => [`${e.type}/${e.name}`, e]));
  const ranked = rankRelevantMemories(query, store, options);
  return ranked
    .map((r) => byId.get(r.id))
    .filter((e): e is MemoryEntry => e !== undefined);
}
