// =============================================================================
// Clusters - deterministic k-means over memory embeddings (spec Phase 3).
// Produces Cluster nodes + InCluster edges so cascade can relay between
// semantically-similar memories that share no explicit tag/wikilink.
//
// DETERMINISM (spec §8): points are sorted by id, the RNG is a fixed-seed
// mulberry32, and k-means++ seeding draws from it — so two rebuilds on the same
// embeddings yield identical clusters. Vectors are already L2-normalized, so
// this is spherical k-means: "nearest" = max dot product, centroids are the
// renormalized mean of their members.
// =============================================================================

import type { GraphEdge, GraphNode } from "./graph-types.js";
import { EDGE_WEIGHTS } from "./graph-types.js";

const SEED = 42;
const MIN_POINTS = 6; // below this, clustering isn't meaningful
const MAX_ITERS = 25;

export interface ClusterResult {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

// Deterministic PRNG (mulberry32) — same seed ⇒ same sequence ⇒ same clusters.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function dot(a: Float32Array, b: Float32Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

function chooseK(n: number): number {
  return Math.min(n, Math.max(2, Math.round(Math.sqrt(n / 2))));
}

function nearest(vec: Float32Array, centroids: Float32Array[]): number {
  let best = 0;
  let bestDot = -Infinity;
  for (let c = 0; c < centroids.length; c++) {
    const d = dot(vec, centroids[c]);
    if (d > bestDot) {
      bestDot = d;
      best = c;
    }
  }
  return best;
}

// k-means++ seeding, weighted by squared cosine distance, using the seeded RNG.
function seedCentroids(
  points: Float32Array[],
  k: number,
  rng: () => number,
): Float32Array[] {
  const centroids: Float32Array[] = [points[Math.floor(rng() * points.length)]];
  const d2 = new Array(points.length).fill(Infinity);
  while (centroids.length < k) {
    const last = centroids[centroids.length - 1];
    let total = 0;
    for (let i = 0; i < points.length; i++) {
      const dist = 1 - dot(points[i], last); // cosine distance
      const sq = dist * dist;
      if (sq < d2[i]) d2[i] = sq;
      total += d2[i];
    }
    let r = rng() * total;
    let idx = 0;
    for (; idx < points.length - 1; idx++) {
      r -= d2[idx];
      if (r <= 0) break;
    }
    centroids.push(points[idx]);
  }
  return centroids.map((c) => Float32Array.from(c));
}

export function computeClusters(
  points: Array<{ id: string; vec: Float32Array }>,
): ClusterResult {
  const n = points.length;
  if (n < MIN_POINTS) return { nodes: [], edges: [] };

  // Sort by id so the input order (insertion order) can't perturb the result.
  const sorted = [...points].sort((a, b) => a.id.localeCompare(b.id));
  const vecs = sorted.map((p) => p.vec);
  const dim = vecs[0].length;
  const k = chooseK(n);
  const rng = mulberry32(SEED);

  const centroids = seedCentroids(vecs, k, rng);
  const assign = new Array(n).fill(-1);

  for (let iter = 0; iter < MAX_ITERS; iter++) {
    let changed = false;
    for (let i = 0; i < n; i++) {
      const c = nearest(vecs[i], centroids);
      if (c !== assign[i]) {
        assign[i] = c;
        changed = true;
      }
    }
    if (!changed) break;

    // Recompute centroids as the renormalized mean of assigned members.
    const sums = centroids.map(() => new Float32Array(dim));
    const counts = new Array(k).fill(0);
    for (let i = 0; i < n; i++) {
      const c = assign[i];
      counts[c]++;
      const s = sums[c];
      for (let d = 0; d < dim; d++) s[d] += vecs[i][d];
    }
    for (let c = 0; c < k; c++) {
      if (counts[c] === 0) continue; // keep an empty centroid put; it just wins nothing
      let norm = 0;
      for (let d = 0; d < dim; d++) norm += sums[c][d] * sums[c][d];
      norm = Math.sqrt(norm) || 1;
      for (let d = 0; d < dim; d++) sums[c][d] /= norm;
      centroids[c] = sums[c];
    }
  }

  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const used = new Set<number>();
  for (let i = 0; i < n; i++) {
    const c = assign[i];
    const cid = `cluster:${c}`;
    if (!used.has(c)) {
      nodes.push({ id: cid, kind: "Cluster", label: `cluster ${c}` });
      used.add(c);
    }
    edges.push({
      from: sorted[i].id,
      to: cid,
      kind: "InCluster",
      weight: EDGE_WEIGHTS.InCluster,
    });
  }
  return { nodes, edges };
}
