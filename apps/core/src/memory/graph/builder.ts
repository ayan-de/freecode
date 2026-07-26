// =============================================================================
// Builder - derive graph nodes & edges from the memory files (spec §4).
// Fully deterministic and model-free: [[wikilink]] → RelatesTo, tags → HasTag,
// frontmatter `supersedes` → Supersedes. Dangling links (no matching memory)
// are skipped, matching the "a [[name]] that doesn't exist yet is fine" rule.
// =============================================================================

import type { MemoryEntry, MemoryType } from "../mem-types.js";
import { MEMORY_TYPES } from "../mem-types.js";
import type { GraphEdge, GraphNode } from "./graph-types.js";
import { EDGE_WEIGHTS } from "./graph-types.js";

const WIKILINK_RE = /\[\[([^\]]+)\]\]/g;

export function memoryId(type: MemoryType, name: string): string {
  return `${type}/${name}`;
}

function tagId(tag: string): string {
  return `tag:${tag.toLowerCase()}`;
}

// Resolve a bare `[[name]]` / supersedes name to a memory id. Names are unique
// per type; if the same name exists under multiple types, pick deterministically
// by MEMORY_TYPES order so rebuilds are stable.
function resolveName(
  name: string,
  byName: Map<string, MemoryEntry[]>,
): string | undefined {
  const matches = byName.get(name.trim());
  if (!matches || matches.length === 0) return undefined;
  const sorted = [...matches].sort(
    (a, b) => MEMORY_TYPES.indexOf(a.type) - MEMORY_TYPES.indexOf(b.type),
  );
  return memoryId(sorted[0].type, sorted[0].name);
}

export function deriveGraph(entries: MemoryEntry[]): {
  nodes: GraphNode[];
  edges: GraphEdge[];
} {
  const nodes = new Map<string, GraphNode>();
  const edges: GraphEdge[] = [];
  const seen = new Set<string>(); // dedupe identical edges

  const byName = new Map<string, MemoryEntry[]>();
  for (const e of entries) {
    const list = byName.get(e.name) ?? [];
    list.push(e);
    byName.set(e.name, list);
  }

  const addNode = (node: GraphNode) => {
    if (!nodes.has(node.id)) nodes.set(node.id, node);
  };
  const addEdge = (from: string, to: string, kind: GraphEdge["kind"]) => {
    if (from === to) return;
    const key = `${from}|${to}|${kind}`;
    if (seen.has(key)) return;
    seen.add(key);
    edges.push({ from, to, kind, weight: EDGE_WEIGHTS[kind] });
  };

  for (const e of entries) {
    const id = memoryId(e.type, e.name);
    addNode({ id, kind: "Memory", label: e.name });

    // tags → HasTag
    for (const tag of e.tags ?? []) {
      const tid = tagId(tag);
      addNode({ id: tid, kind: "Tag", label: tag });
      addEdge(id, tid, "HasTag");
    }

    // [[wikilink]] in body → RelatesTo
    for (const match of e.content.matchAll(WIKILINK_RE)) {
      const target = resolveName(match[1], byName);
      if (target) addEdge(id, target, "RelatesTo");
    }

    // frontmatter supersedes → Supersedes
    for (const name of e.supersedes ?? []) {
      const target = resolveName(name, byName);
      if (target) addEdge(id, target, "Supersedes");
    }
  }

  return { nodes: [...nodes.values()], edges };
}

// Cheap signature over the graph-relevant fields, so the service only rebuilds
// (and rewrites graph.json) when tags / wikilinks / supersedes actually change.
export function graphSignature(entries: MemoryEntry[]): string {
  const parts = entries
    .map((e) => {
      const links = [...e.content.matchAll(WIKILINK_RE)].map((m) => m[1].trim());
      return [
        memoryId(e.type, e.name),
        (e.tags ?? []).join(","),
        (e.supersedes ?? []).join(","),
        links.join(","),
      ].join("|");
    })
    .sort();
  return parts.join("\n");
}
