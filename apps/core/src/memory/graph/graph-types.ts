// =============================================================================
// Graph types - nodes, edges, and edge weights for cascade retrieval (spec D3/D4).
// =============================================================================

export type NodeKind = "Memory" | "Tag" | "Cluster";

export interface GraphNode {
  id: string; // Memory: `type/name`; Tag: `tag:<name>`; Cluster: `cluster:<n>`
  kind: NodeKind;
  label: string;
}

export type EdgeKind =
  | "HasTag"
  | "RelatesTo"
  | "Supersedes"
  | "Contradicts"
  | "InCluster";

export interface GraphEdge {
  from: string;
  to: string;
  kind: EdgeKind;
  weight: number;
}

// Cascade edge weights (spec D4). `Contradicts` is a negative signal and is
// excluded from cascade scoring — cascade.ts skips it entirely.
export const EDGE_WEIGHTS: Record<EdgeKind, number> = {
  Supersedes: 0.9,
  HasTag: 0.8,
  RelatesTo: 0.7,
  InCluster: 0.6, // Phase 3
  Contradicts: 0,
};

export interface RetrievalResult {
  id: string;
  score: number;
  // Which edge carried this result's score from a seed. `null` for the seed
  // itself. Surfaced for the graph explorer's `/api/search` endpoint so the UI
  // can highlight the walked path; the cascade scoring itself does not read it
  // and is byte-for-byte identical whether or not it's populated.
  via?: { from: string; edgeKind: EdgeKind } | null;
}
