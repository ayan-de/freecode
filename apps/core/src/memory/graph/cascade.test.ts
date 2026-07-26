import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GraphStore } from "./graph-store.js";
import { cascadeRetrieve } from "./cascade.js";
import { EDGE_WEIGHTS, type GraphEdge, type GraphNode } from "./graph-types.js";

function edge(from: string, to: string, kind: GraphEdge["kind"]): GraphEdge {
  return { from, to, kind, weight: EDGE_WEIGHTS[kind] };
}

test("cascade reaches RelatesTo/tag-hub neighbours and skips Contradicts", () => {
  const dir = mkdtempSync(join(tmpdir(), "cascade-"));
  try {
    const nodes: GraphNode[] = [
      { id: "project/a", kind: "Memory", label: "a" },
      { id: "project/b", kind: "Memory", label: "b" },
      { id: "project/c", kind: "Memory", label: "c" },
      { id: "project/d", kind: "Memory", label: "d" },
      { id: "tag:infra", kind: "Tag", label: "infra" },
    ];
    const edges: GraphEdge[] = [
      edge("project/a", "project/b", "RelatesTo"),
      edge("project/a", "tag:infra", "HasTag"),
      edge("project/c", "tag:infra", "HasTag"), // c reachable via tag hub at depth 2
      edge("project/a", "project/d", "Contradicts"), // must NOT surface d
    ];
    const graph = new GraphStore(dir);
    graph.set(nodes, edges);

    const results = cascadeRetrieve(
      [{ id: "project/a", score: 1 }],
      graph,
      { maxDepth: 2 },
    );
    const ids = results.map((r) => r.id);

    assert.ok(ids.includes("project/a"), "seed present");
    assert.ok(ids.includes("project/b"), "RelatesTo neighbour retrieved");
    assert.ok(ids.includes("project/c"), "reachable via tag hub at depth 2");
    assert.ok(!ids.includes("project/d"), "Contradicts neighbour excluded");
    assert.ok(!ids.includes("tag:infra"), "Tag nodes never scored into result");

    // Seed outranks a cascaded neighbour.
    const a = results.find((r) => r.id === "project/a")!;
    const b = results.find((r) => r.id === "project/b")!;
    assert.ok(a.score > b.score);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("cascade respects maxDepth", () => {
  const dir = mkdtempSync(join(tmpdir(), "cascade-"));
  try {
    const nodes: GraphNode[] = [
      { id: "project/a", kind: "Memory", label: "a" },
      { id: "project/b", kind: "Memory", label: "b" },
      { id: "project/c", kind: "Memory", label: "c" },
    ];
    const edges: GraphEdge[] = [
      edge("project/a", "project/b", "RelatesTo"),
      edge("project/b", "project/c", "RelatesTo"), // c is 2 hops from a
    ];
    const graph = new GraphStore(dir);
    graph.set(nodes, edges);

    const depth1 = cascadeRetrieve([{ id: "project/a", score: 1 }], graph, {
      maxDepth: 1,
    }).map((r) => r.id);
    assert.ok(!depth1.includes("project/c"), "c is beyond depth 1");

    const depth2 = cascadeRetrieve([{ id: "project/a", score: 1 }], graph, {
      maxDepth: 2,
    }).map((r) => r.id);
    assert.ok(depth2.includes("project/c"), "c reachable at depth 2");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
