// =============================================================================
// GraphStore - Map-based adjacency for the memory knowledge graph.
// Derived index (spec D1): graph.json is rebuildable from the markdown files.
// Traversal treats edges as undirected (a RelatesTo A→B lets B's context surface
// A too), so neighbors() returns incident edges in both directions.
// =============================================================================

import * as fs from "fs";
import * as path from "path";
import type { GraphEdge, GraphNode } from "./graph-types.js";

const SCHEMA_VERSION = 1;
const GRAPH_FILE = "graph.json";

interface GraphFile {
  schemaVersion: number;
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface Neighbor {
  to: string;
  kind: GraphEdge["kind"];
  weight: number;
}

function atomicWrite(filePath: string, data: string): void {
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, filePath);
}

export class GraphStore {
  private dir: string;
  private nodes = new Map<string, GraphNode>();
  private edges: GraphEdge[] = [];
  // Undirected adjacency for traversal, derived from edges.
  private adj = new Map<string, Neighbor[]>();

  constructor(graphDir: string) {
    this.dir = graphDir;
    this.load();
  }

  private load(): void {
    try {
      const data: GraphFile = JSON.parse(
        fs.readFileSync(path.join(this.dir, GRAPH_FILE), "utf-8"),
      );
      // Schema mismatch → drop it; the service rebuilds from files (D1).
      if (data.schemaVersion !== SCHEMA_VERSION) return;
      this.set(data.nodes, data.edges);
    } catch {
      // Missing / unreadable → start empty.
    }
  }

  // Replace the whole graph (builder derives it fresh from the files).
  set(nodes: GraphNode[], edges: GraphEdge[]): void {
    this.nodes = new Map(nodes.map((n) => [n.id, n]));
    this.edges = edges;
    this.adj = new Map();
    for (const e of edges) {
      this.link(e.from, { to: e.to, kind: e.kind, weight: e.weight });
      this.link(e.to, { to: e.from, kind: e.kind, weight: e.weight });
    }
  }

  private link(from: string, n: Neighbor): void {
    const list = this.adj.get(from) ?? [];
    list.push(n);
    this.adj.set(from, list);
  }

  persist(): void {
    fs.mkdirSync(this.dir, { recursive: true });
    const data: GraphFile = {
      schemaVersion: SCHEMA_VERSION,
      nodes: [...this.nodes.values()],
      edges: this.edges,
    };
    atomicWrite(path.join(this.dir, GRAPH_FILE), JSON.stringify(data));
  }

  getNode(id: string): GraphNode | undefined {
    return this.nodes.get(id);
  }

  // Incident edges (both directions), sorted for deterministic traversal.
  neighbors(id: string): Neighbor[] {
    const list = this.adj.get(id) ?? [];
    return [...list].sort(
      (a, b) => a.to.localeCompare(b.to) || a.kind.localeCompare(b.kind),
    );
  }

  nodeCount(): number {
    return this.nodes.size;
  }

  edgeCount(): number {
    return this.edges.length;
  }
}
