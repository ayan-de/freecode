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
}
