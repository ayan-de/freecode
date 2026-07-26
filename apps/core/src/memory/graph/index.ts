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
import { containsSecret } from "./secret-filter.js";
import type { GraphEdge, GraphNode, RetrievalResult } from "./graph-types.js";

const GRAPH_DIR = ".graph";
const K_INITIAL = 10; // seed pool size before cascade
const SEED_THRESHOLD = 0.4; // min cosine for a vector seed
// On a cold turn (empty stash — a session's first message, or right after a
// topic change), wait this long for the in-flight retrieval to land before
// giving up and letting it finish in the background (spec D5 first-turn budget).
const COLD_BUDGET_MS = 60;
const MAX_SESSIONS = 64; // LRU cap on the per-session cache

// Per-session prepared-memory cache (one-turn-behind state).
interface SessionMemory {
  stash: MemoryEntry[];
  lastQuery: string;
  inflight: Promise<void> | null;
}

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
// Below this token-overlap the new context is treated as a topic change and the
// stale surfaced set is dropped. A cheap, hot-path-safe proxy for jcode's
// embedding-cosine < 0.3 heuristic (the real embed runs off the hot path).
const TOPIC_SIM_MIN = 0.12;

function queryTokens(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length > 2),
  );
}

// Jaccard token overlap in [0,1]. Used only for topic-change detection.
export function lexicalSimilarity(a: string, b: string): number {
  const A = queryTokens(a);
  const B = queryTokens(b);
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return inter / (A.size + B.size - inter);
}

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
  // Async, one-turn-behind injection (spec D5). The graph/vector index is shared
  // per project, but the "prepared memories" cache is PER SESSION so two sessions
  // in the same project never clobber each other's surfaced set. Bounded by an
  // LRU cap; each entry is tiny (a few entry refs + a query string).
  private sessions = new Map<string, SessionMemory>();

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
        const text = embedText(e);
        // Never embed a secret-bearing memory (spec §7); drop any stale vector.
        if (containsSecret(text)) {
          if (this.vectors.has(id)) {
            await this.enqueue(async () => this.vectors.remove(id));
          }
          return;
        }
        const hash = hashOf(text);
        if (this.vectors.hasFresh(id, hash)) return;
        const vec = await embedder.embed(text);
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
      const text = embedText(e);
      // Secret-bearing memories are never embedded (spec §7); prune any vector
      // that predates the secret (or a prior non-secret version).
      if (containsSecret(text)) {
        if (this.vectors.has(id)) {
          await this.enqueue(async () => this.vectors.remove(id));
        }
        continue;
      }
      const hash = hashOf(text);
      if (this.vectors.hasFresh(id, hash)) continue;
      if (!embedder.available()) return; // backend died mid-sync → bail
      let vec: Float32Array;
      try {
        vec = await embedder.embed(text);
      } catch {
        // Backend just went unavailable (e.g. missing native lib). embed()
        // flipped available() → false; stop embedding and let retrieval fall
        // back to keyword/graph. Never throw out of sync (spec D6).
        return;
      }
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

  private sessionMemory(sessionId: string): SessionMemory {
    let st = this.sessions.get(sessionId);
    if (st) {
      // LRU touch: move to most-recently-used.
      this.sessions.delete(sessionId);
      this.sessions.set(sessionId, st);
      return st;
    }
    st = { stash: [], lastQuery: "", inflight: null };
    this.sessions.set(sessionId, st);
    while (this.sessions.size > MAX_SESSIONS) {
      const oldest = this.sessions.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.sessions.delete(oldest);
    }
    return st;
  }

  // Prepare the memories to inject for `sessionId`'s current context and return
  // them (spec D5). Warm turns return the previously surfaced set instantly and
  // refresh in the background (one-turn-behind). A cold turn (session's first
  // message, or right after a topic change clears the set) waits a small budget
  // for the fresh retrieval, then falls back to background. Per-session, so
  // sessions in the same project never share a stash. Never throws.
  async prepareMemories(
    sessionId: string,
    query: string,
  ): Promise<MemoryEntry[]> {
    const st = this.sessionMemory(sessionId);
    const q = query.trim();
    if (q.length === 0) return st.stash;

    // Topic change → drop the stale set so we don't inject off-topic memories.
    if (st.lastQuery && lexicalSimilarity(q, st.lastQuery) < TOPIC_SIM_MIN) {
      st.stash = [];
    }
    const cold = st.stash.length === 0;
    st.lastQuery = q;
    this.kickPrefetch(st);

    // Cold start: give the in-flight retrieval a brief chance to land.
    if (cold && st.inflight) {
      await Promise.race([st.inflight, delay(COLD_BUDGET_MS)]);
    }
    return st.stash;
  }

  // Background retrieval that fills a session's stash. Coalesced (one in flight
  // per session) and re-checks lastQuery so a mid-flight topic switch retries.
  private kickPrefetch(st: SessionMemory): void {
    if (st.inflight) return;
    st.inflight = (async () => {
      try {
        for (let q = st.lastQuery; ; q = st.lastQuery) {
          const results = await this.retrieve(q);
          if (q === st.lastQuery) {
            st.stash = results;
            return;
          }
        }
      } catch {
        // Keep the previous stash; nothing invalid gets injected.
      } finally {
        st.inflight = null;
      }
    })();
  }

  // Drop a session's prepared-memory cache (e.g. on session end).
  disposeSession(sessionId: string): void {
    this.sessions.delete(sessionId);
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
// Factory — one durable service per project. Durable (not a swapping singleton)
// so switching projects in a long-running daemon doesn't leak an onMemoryChange
// listener per switch, and each project's cache/state survives across turns.
// =============================================================================

const services = new Map<string, MemoryGraphService>();

export function getMemoryGraphService(projectPath: string): MemoryGraphService {
  let service = services.get(projectPath);
  if (!service) {
    service = new MemoryGraphService(getMemoryStore(projectPath));
    services.set(projectPath, service);
  }
  return service;
}

// Drop a session's prepared-memory cache from whichever project holds it.
// Call on session end so the per-session cache doesn't accumulate.
export function disposeSessionMemory(sessionId: string): void {
  for (const service of services.values()) service.disposeSession(sessionId);
}
