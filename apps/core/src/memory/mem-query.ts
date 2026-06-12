// =============================================================================
// Memory Query - Find relevant memories for a query
// Simple keyword-based relevance matching (no LLM needed)
// =============================================================================

import type { MemoryEntry, MemoryType, MemoryQueryOptions } from "./mem-types";
import { MemoryStore } from "./mem-store";

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-zA-Z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2);
}

function score(query: string, entry: MemoryEntry): number {
  const queryTokens = tokenize(query);
  const descTokens = tokenize(entry.description);
  const contentTokens = tokenize(entry.content);

  let score = 0;

  // Exact name match
  if (entry.name.toLowerCase().includes(query.toLowerCase())) {
    score += 10;
  }

  // Description match (highest weight)
  for (const qt of queryTokens) {
    for (const dt of descTokens) {
      if (dt.includes(qt) || qt.includes(dt)) {
        score += 5;
      }
    }
  }

  // Content match (lower weight)
  for (const qt of queryTokens) {
    for (const ct of contentTokens) {
      if (ct.includes(qt) || qt.includes(ct)) {
        score += 1;
      }
    }
  }

  return score;
}

export function findRelevantMemories(
  query: string,
  store: MemoryStore,
  options: MemoryQueryOptions = {},
): MemoryEntry[] {
  const { limit = 5, types } = options;

  let entries = store.list();
  if (types && types.length > 0) {
    entries = entries.filter((e) => types.includes(e.type));
  }

  // Score and sort
  const scored = entries.map((entry) => ({
    entry,
    score: score(query, entry),
  }));

  scored.sort((a, b) => b.score - a.score);

  return scored.slice(0, limit).map((s) => s.entry);
}
