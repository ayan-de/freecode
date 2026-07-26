// =============================================================================
// MemoryGraphService - single entry point the loop / IPC call (spec §4).
// Vector retrieval (Phase 1) now feeds a cascade walk over a derived graph
// (Phase 2): seeds from cosine top-k (or keyword fallback, D6) expand along
// tag / wikilink / supersede edges. Wraps MemoryStore, never replaces it.
// =============================================================================

import * as crypto from "crypto";
import * as path from "path";
import type { MemoryEntry, MemoryQueryOptions } from "../mem-types.js";
import { MemoryStore, getMemoryStore, onMemoryChange } from "../mem-store.js";
import type { MemoryChange } from "../mem-store.js";
import { findRelevantMemories } from "../mem-query.js";
import * as embedder from "./embedder.js";
import { MODEL_ID } from "./embedder.js";
import { VectorStore } from "./vector-store.js";
import { GraphStore } from "./graph-store.js";
import { deriveGraph, graphSignature, memoryId } from "./builder.js";
import { cascadeRetrieve } from "./cascade.js";
import { computeClusters } from "./clusters.js";
import type { GraphEdge, GraphNode, RetrievalResult } from "./graph-types.js";

const GRAPH_DIR = ".graph";
const K_INITIAL = 10; // seed pool size before cascade
const SEED_THRESHOLD = 0.4; // min cosine for a vector seed

function splitId(id: string): { type: MemoryEntry["type"]; name: string } {
  const slash = id.indexOf("/");
  return {
    type: id.slice(0, slash) as MemoryEntry["type"],
    name: id.slice(slash + 1),
  };
}

// What we embed for a memory: name + description + body carry its meaning.
function embedText(e: MemoryEntry): string {
  return `${e.name}\n${e.description}\n${e.content}`;
}

function hashOf(text: string): string {
  return crypto.createHash("sha256").update(text).digest("hex");
}

export class MemoryGraphService {
  private store: MemoryStore;
  private vectors: VectorStore;
  private graph: GraphStore;
  // The graph is assembled from two layers: a deterministic, model-free base
  // (Memory/Tag nodes + tag/link/supersede edges) and a cluster layer derived
  // from embeddings. Each is rebuilt only when its own signature changes.
  private baseNodes: GraphNode[] = [];
  private baseEdges: GraphEdge[] = [];
  private clusterNodes: GraphNode[] = [];
  private clusterEdges: GraphEdge[] = [];
  private lastGraphSig = "";
  private lastVectorSig = "";
  // Single-flight queue so concurrent saves can't corrupt the sidecar (D2).
  private queue: Promise<void> = Promise.resolve();

  constructor(store: MemoryStore) {
    this.store = store;
    const dir = path.join(store.getMemoryDir(), GRAPH_DIR);
    this.vectors = new VectorStore(dir, MODEL_ID);
    this.graph = new GraphStore(dir);
    onMemoryChange((change) => {
      if (change.store.getMemoryDir() === this.store.getMemoryDir()) {
        void this.onChange(change);
      }
    });
  }

  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    this.queue = run.then(
      () => {},
      () => {},
    );
    return run;
  }

  // Incremental vector update on save/delete — fire-and-forget, never throws.
  // Graph edges are refreshed lazily in sync() (cheap, no model needed).
  async onChange(change: MemoryChange): Promise<void> {
    try {
      if (change.deleted) {
        const id = memoryId(change.deleted.type, change.deleted.name);
        await this.enqueue(async () => this.vectors.remove(id));
        this.lastGraphSig = ""; // force graph rebuild next retrieve
        return;
      }
      if (change.entry) {
        this.lastGraphSig = ""; // tags/links may have changed
        if (!embedder.available()) return;
        const e = change.entry;
        const id = memoryId(e.type, e.name);
        const hash = hashOf(embedText(e));
        if (this.vectors.hasFresh(id, hash)) return;
        const vec = await embedder.embed(embedText(e));
        await this.enqueue(async () => this.vectors.put(id, hash, vec));
      }
    } catch {
      // Eventual consistency: picked up on the next drain / sync.
    }
  }

  // Rebuild the base layer from files when tags/links/supersedes changed
  // (cheap, deterministic). Returns whether it changed.
  private syncBase(entries: MemoryEntry[]): boolean {
    const sig = graphSignature(entries);
    if (sig === this.lastGraphSig && this.baseNodes.length > 0) return false;
    const { nodes, edges } = deriveGraph(entries);
    this.baseNodes = nodes;
    this.baseEdges = edges;
    this.lastGraphSig = sig;
    return true;
  }

  // Recompute the cluster layer when the embedding set changed (periodic, not
  // per-write — spec Phase 3). Deterministic, so rebuilds are stable.
  private syncClusters(): boolean {
    const sig = this.vectors.fingerprint();
    if (sig === this.lastVectorSig) return false;
    const { nodes, edges } = computeClusters(this.vectors.all());
    this.clusterNodes = nodes;
    this.clusterEdges = edges;
    this.lastVectorSig = sig;
    return true;
  }

  // Assemble base + cluster layers into the traversable graph and persist.
  private applyGraph(): void {
    this.graph.set(
      [...this.baseNodes, ...this.clusterNodes],
      [...this.baseEdges, ...this.clusterEdges],
    );
    this.graph.persist();
  }

  // Bring the vector index in line with the files: embed changed/missing
  // entries, drop stale ones. Serialized through the write queue.
  private async syncVectors(entries: MemoryEntry[]): Promise<void> {
    const liveIds = new Set<string>();
    for (const e of entries) {
      const id = memoryId(e.type, e.name);
      liveIds.add(id);
      const hash = hashOf(embedText(e));
      if (this.vectors.hasFresh(id, hash)) continue;
      if (!embedder.available()) return; // backend died mid-sync → bail
      const vec = await embedder.embed(embedText(e));
      await this.enqueue(async () => this.vectors.put(id, hash, vec));
    }
    for (const id of this.vectors.allIds()) {
      if (!liveIds.has(id)) {
        await this.enqueue(async () => this.vectors.remove(id));
      }
    }
  }

  private async sync(entries: MemoryEntry[]): Promise<void> {
    const baseChanged = this.syncBase(entries); // deterministic, no model
    await this.syncVectors(entries); // embeddings, skipped if unavailable
    const clustersChanged = this.syncClusters(); // over the fresh embeddings
    if (baseChanged || clustersChanged || this.graph.nodeCount() === 0) {
      this.applyGraph();
    }
  }

  // Seed pool for the cascade: vector top-k when embeddings are available,
  // otherwise the keyword scorer (spec D6) — either way, cascade expands it.
  private async seed(query: string): Promise<RetrievalResult[]> {
    if (embedder.available() && query.trim().length > 0) {
      try {
        const qvec = await embedder.embed(query);
        const top = this.vectors.cosineTopK(qvec, K_INITIAL, SEED_THRESHOLD);
        if (top.length > 0) return top;
      } catch {
        // fall through to keyword seeds
      }
    }
    const kw = findRelevantMemories(query, this.store, { limit: K_INITIAL });
    // Synthetic descending scores keep keyword order meaningful in the cascade.
    return kw.map((e, i) => ({
      id: memoryId(e.type, e.name),
      score: 1 - i * 0.05,
    }));
  }

  // Retrieve the memories most relevant to `query`, expanded by graph cascade.
  // Never throws — falls back to the keyword list on any failure (spec D6).
  async retrieve(
    query: string,
    options: MemoryQueryOptions = {},
  ): Promise<MemoryEntry[]> {
    const { limit = 8, types } = options;
    const fallback = () => findRelevantMemories(query, this.store, options);

    try {
      const entries = this.store.list();
      if (entries.length === 0) return [];
      await this.sync(entries);

      const seeds = await this.seed(query);
      if (seeds.length === 0) return fallback();

      const scored = cascadeRetrieve(seeds, this.graph, { maxDepth: 2 });
      const out: MemoryEntry[] = [];
      for (const { id } of scored) {
        const { type, name } = splitId(id);
        if (types && types.length > 0 && !types.includes(type)) continue;
        const entry = this.store.load(name, type);
        if (entry) out.push(entry);
        if (out.length >= limit) break;
      }
      return out.length > 0 ? out : fallback();
    } catch {
      return fallback();
    }
  }

  // Full rebuild from files (maintenance). Clears vectors + graph, re-syncs.
  async rebuild(): Promise<void> {
    await this.enqueue(async () => this.vectors.clear());
    this.lastGraphSig = "";
    this.lastVectorSig = "";
    await this.sync(this.store.list());
  }

  stats(): {
    vectors: number;
    dims: number;
    nodes: number;
    edges: number;
    clusters: number;
    embedder: boolean;
  } {
    return {
      vectors: this.vectors.size(),
      dims: this.vectors.getDims(),
      nodes: this.graph.nodeCount(),
      edges: this.graph.edgeCount(),
      clusters: this.clusterNodes.length,
      embedder: embedder.available(),
    };
  }
}

// =============================================================================
// Factory — one service per project, mirroring getMemoryStore.
// =============================================================================

let globalService: MemoryGraphService | null = null;
let globalProjectPath: string | null = null;

export function getMemoryGraphService(projectPath: string): MemoryGraphService {
  if (!globalService || globalProjectPath !== projectPath) {
    globalService = new MemoryGraphService(getMemoryStore(projectPath));
    globalProjectPath = projectPath;
  }
  return globalService;
}
