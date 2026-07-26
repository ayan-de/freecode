// =============================================================================
// Cascade retrieval - BFS over the graph from vector/keyword seeds (spec D4).
// Starts from scored seed memories, walks edges up to `maxDepth` hops, and
// accumulates score onto Memory nodes reached along the way. Tag nodes act as
// hubs (traversed, never scored into the result). `Contradicts` is skipped
// entirely — a contradiction is a negative signal, not a relevance boost.
// =============================================================================

import type { RetrievalResult } from "./graph-types.js";
import type { GraphStore } from "./graph-store.js";

const DECAY = 0.7; // score multiplier per hop

export interface CascadeOptions {
  maxDepth?: number; // default 2
  limit?: number; // final top-k
}

interface Frontier {
  id: string;
  depth: number;
  score: number;
}

export function cascadeRetrieve(
  seeds: RetrievalResult[],
  graph: GraphStore,
  options: CascadeOptions = {},
): RetrievalResult[] {
  const maxDepth = options.maxDepth ?? 2;
  const scores = new Map<string, number>();
  const visited = new Set<string>();
  const queue: Frontier[] = [];

  // Seeds anchor the walk with their similarity score.
  for (const s of seeds) {
    scores.set(s.id, Math.max(scores.get(s.id) ?? 0, s.score));
    visited.add(s.id);
    queue.push({ id: s.id, depth: 0, score: s.score });
  }

  while (queue.length > 0) {
    const cur = queue.shift()!;
    if (cur.depth >= maxDepth) continue;

    for (const edge of graph.neighbors(cur.id)) {
      if (edge.kind === "Contradicts") continue; // negative signal (D4)
      if (visited.has(edge.to)) continue;
      visited.add(edge.to);

      const contribution = cur.score * edge.weight * DECAY;
      const node = graph.getNode(edge.to);
      // Only Memory nodes count toward the result; Tags/Clusters just relay.
      if (node?.kind === "Memory") {
        scores.set(edge.to, (scores.get(edge.to) ?? 0) + contribution);
      }
      queue.push({ id: edge.to, depth: cur.depth + 1, score: contribution });
    }
  }

  const results: RetrievalResult[] = [];
  for (const [id, score] of scores) {
    const node = graph.getNode(id);
    // Keep seeds even if the graph has no node for them yet (index still syncing).
    if (!node || node.kind === "Memory") results.push({ id, score });
  }
  results.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  return options.limit ? results.slice(0, options.limit) : results;
}
