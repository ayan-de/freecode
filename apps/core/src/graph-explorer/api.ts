// =============================================================================
// Memory Graph Explorer — JSON API (spec: docs/superpowers/specs/2026-08-04-
// memory-graph-explorer-design.md).
//
// Two endpoints, both pure read-views over an existing MemoryGraphService:
//   GET /api/graph   → { nodes, edges, embedderAvailable }
//   GET /api/search  → { results: RetrievalResult[], seedMode }
//
// Splitting this from the static server (graph-explorer/server.ts) means the
// API is testable in isolation: a handler factory takes the service as a
// dependency, no http server required. The static server wires the same
// handlers in front of a real listener.
// =============================================================================

import type { IncomingMessage, ServerResponse } from "http";
import type { MemoryGraphService } from "../memory/graph/index.js";
import type { RetrievalResult } from "../memory/graph/graph-types.js";

export interface GraphApiDeps {
  service: MemoryGraphService;
}

export interface GraphDump {
  nodes: Array<{ id: string; kind: string; label: string }>;
  edges: Array<{
    from: string;
    to: string;
    kind: string;
    weight: number;
  }>;
  embedderAvailable: boolean;
}

export interface SearchResponse {
  results: RetrievalResult[];
  seedMode: "vector" | "keyword";
}

/**
 * What one node actually holds.
 *
 * `/api/graph` sends `{ id, kind, label }` per node — enough to draw, nothing
 * to read. The graph is a derived index; the content lives in the store. This
 * is the endpoint that resolves a node back to it, so clicking a node can show
 * something.
 */
export interface NodeDetailResponse {
  node: { id: string; kind: string; label: string };
  entry: {
    name: string;
    description: string;
    type: string;
    content: string;
    createdAt: number;
    updatedAt: number;
    tags?: string[];
    supersedes?: string[];
  } | null;
  neighbors: Array<{
    id: string;
    kind: string;
    label: string;
    edge: string;
    direction: "out" | "in";
  }>;
}

export type ApiResult =
  | { status: 200; body: GraphDump | SearchResponse | NodeDetailResponse }
  | { status: 400; body: { error: string } }
  | { status: 404; body: { error: string } };

// GET /api/graph — full graph dump + embedder availability. The service's
// dumpGraphForExplorer() triggers a sync against disk, so the explorer sees
// fresh data on first load without a manual rebuild.
export async function handleGraph(
  _req: IncomingMessage,
  _res: ServerResponse,
  deps: GraphApiDeps,
): Promise<ApiResult> {
  const dump = await deps.service.dumpGraphForExplorer();
  return {
    status: 200,
    body: {
      nodes: dump.nodes,
      edges: dump.edges,
      embedderAvailable: dump.embedderAvailable,
    },
  };
}

// GET /api/search?q=... — runs the cascade, returns ids + scores + the
// `via` edge for each non-seed result. Empty query → 400; the cascade
// relies on a non-empty query to compute seeds.
export async function handleSearch(
  _req: IncomingMessage,
  url: URL,
  _res: ServerResponse,
  deps: GraphApiDeps,
): Promise<ApiResult> {
  const q = url.searchParams.get("q") ?? "";
  if (q.trim().length === 0) {
    return { status: 400, body: { error: "missing q parameter" } };
  }
  const { results, seedMode } = await deps.service.retrieveForExplorer(q);
  return { status: 200, body: { results, seedMode } };
}

// GET /api/node?id=... — the memory behind a node, plus its neighbours.
export function handleNode(
  _req: IncomingMessage,
  url: URL,
  _res: ServerResponse,
  deps: GraphApiDeps,
): ApiResult {
  const id = url.searchParams.get("id") ?? "";
  if (id.trim().length === 0) {
    return { status: 400, body: { error: "missing id parameter" } };
  }
  const detail = deps.service.nodeDetailForExplorer(id);
  if (!detail) {
    return { status: 404, body: { error: `no such node: ${id}` } };
  }
  return {
    status: 200,
    body: {
      node: detail.node,
      entry: detail.entry,
      // Flattened for the client: it renders a list, not a graph, and a nested
      // node object per row is one more thing the page has to unwrap.
      neighbors: detail.neighbors.map((n) => ({
        id: n.node.id,
        kind: n.node.kind,
        label: n.node.label,
        edge: n.kind,
        direction: n.direction,
      })),
    },
  };
}

// Dispatches an HTTP request to the right handler. Returns null when the
// path is neither /api/graph nor /api/search so the static server can serve
// other paths (or 404).
export async function dispatchApi(
  req: IncomingMessage,
  url: URL,
  res: ServerResponse,
  deps: GraphApiDeps,
): Promise<ApiResult | null> {
  if (req.method !== "GET") return null;
  if (url.pathname === "/api/graph") {
    return handleGraph(req, res, deps);
  }
  if (url.pathname === "/api/search") {
    return handleSearch(req, url, res, deps);
  }
  if (url.pathname === "/api/node") {
    return handleNode(req, url, res, deps);
  }
  return null;
}

// Helper used by the static server: write an ApiResult to the response. Pulled
// out so the static server can render JSON without importing any graph
// internals beyond the result shape.
export function writeApiResult(res: ServerResponse, result: ApiResult): void {
  res.writeHead(result.status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(result.body));
}
