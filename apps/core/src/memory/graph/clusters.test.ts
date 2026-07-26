import test from "node:test";
import assert from "node:assert/strict";
import { computeClusters } from "./clusters.js";

function norm(xs: number[]): Float32Array {
  let s = 0;
  for (const x of xs) s += x * x;
  const n = Math.sqrt(s) || 1;
  return Float32Array.from(xs.map((x) => x / n));
}

// Three well-separated blobs around distinct axes, 6 points each.
function blobs(): Array<{ id: string; vec: Float32Array }> {
  const pts: Array<{ id: string; vec: Float32Array }> = [];
  const centers = [
    [1, 0, 0, 0],
    [0, 1, 0, 0],
    [0, 0, 1, 0],
  ];
  let i = 0;
  for (let b = 0; b < centers.length; b++) {
    for (let j = 0; j < 6; j++) {
      const jitter = centers[b].map((c) => c + (j % 2 === 0 ? 0.05 : -0.05) * j);
      pts.push({ id: `m${String(i++).padStart(2, "0")}`, vec: norm(jitter) });
    }
  }
  return pts;
}

test("computeClusters is deterministic across runs (fixed seed)", () => {
  const pts = blobs();
  const a = computeClusters(pts);
  const b = computeClusters([...pts].reverse()); // input order must not matter
  assert.equal(JSON.stringify(a), JSON.stringify(b));
});

test("every point gets exactly one InCluster edge with weight 0.6", () => {
  const pts = blobs();
  const { nodes, edges } = computeClusters(pts);
  assert.equal(edges.length, pts.length);
  for (const e of edges) {
    assert.equal(e.kind, "InCluster");
    assert.equal(e.weight, 0.6);
  }
  for (const n of nodes) assert.equal(n.kind, "Cluster");
  // Each memory appears once as an edge source.
  assert.equal(new Set(edges.map((e) => e.from)).size, pts.length);
});

test("identical vectors land in the same cluster", () => {
  const pts = blobs();
  const v = norm([1, 1, 0, 0]);
  pts.push({ id: "twinA", vec: v });
  pts.push({ id: "twinB", vec: v });
  const { edges } = computeClusters(pts);
  const a = edges.find((e) => e.from === "twinA")!.to;
  const b = edges.find((e) => e.from === "twinB")!.to;
  assert.equal(a, b);
});

test("clustering is skipped below the minimum point count", () => {
  const few = [
    { id: "a", vec: norm([1, 0, 0, 0]) },
    { id: "b", vec: norm([0, 1, 0, 0]) },
  ];
  const { nodes, edges } = computeClusters(few);
  assert.equal(nodes.length, 0);
  assert.equal(edges.length, 0);
});
