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
import { findRelevantMemories, rankRelevantMemories } from "../mem-query.js";
import { Bm25Index } from "../bm25.js";
import { fuseByRank, FUSED_FLOOR, RRF_K } from "./fusion.js";
import { judgeMemories, type JudgeDecision } from "../judge.js";
import { UsageStore, type MemoryUsage } from "../usage-store.js";
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
// Episode decay (spec D6). Both are guesses, declared as such in the spec's
// §10 alongside the rest; unlike most of that list they are measurable —
// `pnpm bench:recall` can sweep the half-life over a dated corpus.
const EPISODE_HALF_LIFE_DAYS = 30;
// How far an unused episode can sink, and how far use can lift that floor. The
// ceiling stays below 1.0 so a much-used episode is never treated as brand new.
const EPISODE_DECAY_FLOOR = 0.25;
const EPISODE_DECAY_CEILING = 0.9;

// How to reach a model for the retrieval judge (spec D15). Supplied by the
// caller because the graph service knows nothing about providers; omit it and
// judging is skipped entirely.
export interface JudgeContext {
  provider: string;
  model?: string;
  /** Test seam, forwarded to judgeMemories. */
  complete?: (system: string, prompt: string) => Promise<string>;
}

// Per-session prepared-memory cache (one-turn-behind state).
interface SessionMemory {
  stash: MemoryEntry[];
  lastQuery: string;
  inflight: Promise<void> | null;
  // Ids the judge approved for the current topic, or null when no verdict is
  // carried (first message, or the topic just changed). The cadence carry.
  judgedIds?: Set<string> | null;
  judge?: JudgeContext;
  // Whether `lastQuery` has a completed retrieval (hit or confirmed miss).
  // Lets prepareMemories be called on every turn without re-fetching: once
  // resolved, callers just read `stash` instead of re-kicking retrieve().
  resolved: boolean;
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

// Which retrieval path produced a result. Exhaustive by construction: a new
// code path that surfaces memory has to name itself here, so a silent fallback
// becomes a visible event (spec D14).
export type RetrievalOutcome =
  | "fused" // vector + lexical, ranks combined
  | "lexical_only" // embedder unavailable or mid-query failure
  | "empty_by_floor" // both retrievers ran; nothing cleared the floor
  | "empty_query"
  | "empty_store"
  | "error";

// A retrieved memory with the cascade score that surfaced it. Callers need the
// score to degrade by relevance under a byte budget (D2) and to attribute
// usage back to what was actually injected (D12).
export interface RetrievedMemory {
  entry: MemoryEntry;
  score: number;
}

export class MemoryGraphService {
  private store: MemoryStore;
  private vectors: VectorStore;
  private graph: GraphStore;
  // Lexical half of the seed pool (spec D1). Rebuilt in sync() off the same
  // entry list as the embeddings, so the two halves never disagree about what
  // is in the store.
  private lexical = new Bm25Index();
  // Citation-driven usage counters (spec D12). Derived state alongside the
  // vectors and the graph: delete `.graph/` and retention falls back to age.
  private usage: UsageStore;
  private lastOutcome: RetrievalOutcome = "empty_store";
  private lastDecision: JudgeDecision | "cadence_carry" | "not_configured" =
    "not_configured";
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
  // Unregisters this service's onMemoryChange listener; called by dispose() so
  // an evicted/replaced service doesn't leak a listener into the change bus.
  private unsubscribe: () => void;

  constructor(store: MemoryStore) {
    this.store = store;
    const dir = path.join(store.getMemoryDir(), GRAPH_DIR);
    this.vectors = new VectorStore(dir, MODEL_ID);
    this.graph = new GraphStore(dir);
    this.usage = new UsageStore(dir);
    this.unsubscribe = onMemoryChange((change) => {
      if (change.store.getMemoryDir() === this.store.getMemoryDir()) {
        void this.onChange(change);
      }
    });
  }

  // Release this service: unregister its change listener and drop per-session
  // caches. Safe to call once; the sidecar on disk is untouched (rebuildable).
  dispose(): void {
    this.unsubscribe();
    this.sessions.clear();
    this.usage.dispose();
  }

  // -- Usage attribution (spec D12) -----------------------------------------

  /** Record that these memories were surfaced to the model. */
  recordInjected(entries: MemoryEntry[]): void {
    this.usage.recordInjected(entries.map((e) => memoryId(e.type, e.name)));
  }

  /**
   * Record the model's claim that these ids shaped its answer.
   *
   * Intersected with `injected` on purpose: a model can name a memory it was
   * never shown (or hallucinate an id outright), and crediting one would put
   * noise into the signal that later decides what survives consolidation.
   */
  recordCited(citedIds: string[], injected: MemoryEntry[]): void {
    const shown = new Set(injected.map((e) => memoryId(e.type, e.name)));
    this.usage.recordCited(citedIds.filter((id) => shown.has(id)));
  }

  usageFor(entry: MemoryEntry): MemoryUsage {
    return this.usage.get(memoryId(entry.type, entry.name));
  }

  allUsage(): Map<string, MemoryUsage> {
    return this.usage.all();
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
    this.lexical.build(entries, (e) => memoryId(e.type, e.name)); // BM25 (D1)
    await this.syncVectors(entries); // embeddings, skipped if unavailable
    const clustersChanged = this.syncClusters(); // over the fresh embeddings
    if (baseChanged || clustersChanged || this.graph.nodeCount() === 0) {
      this.applyGraph();
    }
  }

  // Seed pool for the cascade (spec D1). Vector and lexical retrieval are peers,
  // not a primary and a fallback: both run, and their *ranks* are fused with
  // reciprocal rank fusion. Ranks, not scores, because a cosine similarity and a
  // BM25 score are not on comparable scales and any weighted sum of them would
  // be calibrating one against the other by hand.
  //
  // The previous implementation returned vector hits when there were any and the
  // keyword list otherwise, which meant a confident vector miss was silently
  // overridden by the weaker scorer — and, since the lexical floor was "any
  // overlap at all", a query about nothing in the store injected 8 memories.
  private async seed(query: string): Promise<{
    seeds: RetrievalResult[];
    outcome: RetrievalOutcome;
  }> {
    if (query.trim().length === 0) return { seeds: [], outcome: "empty_query" };

    const ranked: string[][] = [];
    let vectorRan = false;

    if (embedder.available()) {
      try {
        const qvec = await embedder.embed(query);
        ranked.push(
          this.vectors
            .cosineTopK(qvec, K_INITIAL, SEED_THRESHOLD)
            .map((r) => r.id),
        );
        vectorRan = true;
      } catch {
        // Embedder just died; lexical still carries the query (KG spec D6).
      }
    }

    // The BM25 index was rebuilt by sync() a moment ago off the same entry
    // list, so this is a scan of an in-memory map — no store read.
    ranked.push(this.lexical.search(query, K_INITIAL).map((r) => r.id));

    const fused = fuseByRank(ranked, RRF_K);
    const seeds = fused.filter((r) => r.score >= FUSED_FLOOR);
    const outcome: RetrievalOutcome =
      seeds.length === 0
        ? "empty_by_floor"
        : vectorRan
          ? "fused"
          : "lexical_only";
    return { seeds, outcome };
  }

  // Retrieve the memories most relevant to `query`, expanded by graph cascade.
  // Never throws. Returns entries with their cascade score so callers can
  // degrade by relevance (spec D2) and attribute usage per memory (spec D12).
  async retrieveScored(
    query: string,
    options: MemoryQueryOptions = {},
  ): Promise<RetrievedMemory[]> {
    const { limit = 8, types } = options;

    try {
      const entries = this.store.list();
      if (entries.length === 0) {
        this.lastOutcome = "empty_store";
        return [];
      }
      await this.sync(entries);

      const { seeds, outcome } = await this.seed(query);
      this.lastOutcome = outcome;
      // An empty seed set is an answer, not a failure to answer: nothing in the
      // store is relevant, so nothing is injected. There is deliberately no
      // fallback here — a fallback is what made the floor unenforceable.
      if (seeds.length === 0) return [];

      const scored = cascadeRetrieve(seeds, this.graph, { maxDepth: 2 });
      const out: RetrievedMemory[] = [];
      for (const { id, score } of scored) {
        const { type, name } = splitId(id);
        if (types && types.length > 0 && !types.includes(type)) continue;
        const entry = this.store.load(name, type);
        if (entry) out.push({ entry, score: this.adjustScore(entry, score) });
      }
      // Decay reorders, so the cap has to come after it — slicing first would
      // let a stale episode displace a fresher one that scored just below it.
      out.sort((a, b) => b.score - a.score);
      return out.slice(0, limit);
    } catch {
      this.lastOutcome = "error";
      // A crash is not evidence about relevance, so this one fallback stays:
      // lexical retrieval is a working retriever, not a degraded guess.
      return findRelevantMemories(query, this.store, options).map((entry) => ({
        entry,
        score: 0,
      }));
    }
  }

  async retrieve(
    query: string,
    options: MemoryQueryOptions = {},
  ): Promise<MemoryEntry[]> {
    return (await this.retrieveScored(query, options)).map((r) => r.entry);
  }

  // Which path produced the most recent retrieval. Recorded so a silent
  // fallback is a visible event rather than something nobody notices for a
  // year — the failure mode that let defect 3 survive (spec D14).
  lastRetrievalOutcome(): RetrievalOutcome {
    return this.lastOutcome;
  }

  // Variant of retrieve() used by the graph explorer's `/api/search` endpoint.
  // Exposes the cascade's raw output (id + score + via) and which path produced
  // it, so the UI can highlight the walked path without paying the round trip
  // to a typed entry.
  //
  // Unlike automatic injection, an explicit search stays permissive: the floor
  // is deliberately not applied here. A human typing a query wants to see weak
  // matches; the floor exists to stop weak matches being fed to the model
  // unasked (spec D1).
  async retrieveForExplorer(query: string): Promise<{
    results: RetrievalResult[];
    seedMode: RetrievalOutcome;
  }> {
    const fallback = (): {
      results: RetrievalResult[];
      seedMode: RetrievalOutcome;
    } => {
      const kw = findRelevantMemories(query, this.store, { limit: 32 });
      return {
        results: kw.map((e, i) => ({
          id: memoryId(e.type, e.name),
          score: 1 - i * 0.05,
        })),
        seedMode: "lexical_only",
      };
    };

    try {
      const entries = this.store.list();
      if (entries.length === 0) return { results: [], seedMode: "empty_store" };
      await this.sync(entries);

      const { seeds, outcome } = await this.seed(query);
      if (seeds.length === 0) return fallback();

      const scored = cascadeRetrieve(seeds, this.graph, { maxDepth: 2 });
      return { results: scored, seedMode: outcome };
    } catch {
      return fallback();
    }
  }

  // Dump the traversable graph for `/api/graph`. Ensures a sync against the
  // current file state first so the explorer sees fresh data even on a
  // never-retrieved service. Returns empty arrays for an empty project rather
  // than throwing.
  async dumpGraphForExplorer(): Promise<{
    nodes: GraphNode[];
    edges: GraphEdge[];
    embedderAvailable: boolean;
  }> {
    try {
      const entries = this.store.list();
      if (entries.length === 0) {
        return {
          nodes: [],
          edges: [],
          embedderAvailable: embedder.available(),
        };
      }
      await this.sync(entries);
    } catch {
      // Best-effort sync — fall through to whatever's already on disk.
    }
    return {
      nodes: this.graph.allNodes(),
      edges: this.graph.allEdges(),
      embedderAvailable: embedder.available(),
    };
  }

  /**
   * The memory behind a graph node, plus its immediate neighbours.
   *
   * The graph itself is a derived index — a `GraphNode` is `{ id, kind, label }`
   * and deliberately carries no content, so the explorer had nothing to show
   * when a node was clicked. This resolves an id back to the stored entry.
   *
   * Only `Memory` nodes have an entry; `tag:` and `cluster:` nodes are
   * synthetic groupings and return `entry: null` with their members as
   * neighbours, which is still the useful thing to show.
   */
  nodeDetailForExplorer(id: string): {
    node: GraphNode;
    entry: MemoryEntry | null;
    neighbors: Array<{
      node: GraphNode;
      kind: string;
      direction: "out" | "in";
    }>;
  } | null {
    const node = this.graph.allNodes().find((n) => n.id === id);
    if (!node) return null;

    const byId = new Map(this.graph.allNodes().map((n) => [n.id, n]));
    const neighbors: Array<{
      node: GraphNode;
      kind: string;
      direction: "out" | "in";
    }> = [];
    for (const edge of this.graph.allEdges()) {
      if (edge.from === id) {
        const other = byId.get(edge.to);
        if (other)
          neighbors.push({ node: other, kind: edge.kind, direction: "out" });
      } else if (edge.to === id) {
        const other = byId.get(edge.from);
        if (other)
          neighbors.push({ node: other, kind: edge.kind, direction: "in" });
      }
    }

    let entry: MemoryEntry | null = null;
    if (node.kind === "Memory" && id.includes("/")) {
      const { type, name } = splitId(id);
      entry = this.store.load(name, type) ?? null;
    }

    return { node, entry, neighbors };
  }

  private sessionMemory(sessionId: string): SessionMemory {
    let st = this.sessions.get(sessionId);
    if (st) {
      // LRU touch: move to most-recently-used.
      this.sessions.delete(sessionId);
      this.sessions.set(sessionId, st);
      return st;
    }
    st = {
      stash: [],
      lastQuery: "",
      inflight: null,
      resolved: false,
      judgedIds: null,
    };
    this.sessions.set(sessionId, st);
    while (this.sessions.size > MAX_SESSIONS) {
      const oldest = this.sessions.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.sessions.delete(oldest);
    }
    return st;
  }

  // The set that would be injected right now, without kicking a retrieval.
  // `/context` needs to price the memory block, and pricing it must not cost a
  // judge call or move the one-turn-behind stash the next real turn depends on.
  peekMemories(sessionId: string): MemoryEntry[] {
    return this.sessions.get(sessionId)?.stash ?? [];
  }

  // Prepare the memories to inject for `sessionId`'s current context and return
  // them (spec D5). Warm turns return the previously surfaced set instantly and
  // refresh in the background (one-turn-behind). A cold turn (session's first
  // message, or right after a topic change clears the set) waits a small budget
  // for the fresh retrieval, then falls back to background. Per-session, so
  // sessions in the same project never share a stash. Never throws.
  //
  // Safe to call every turn (not just when the query text changes): once a
  // query is `resolved` (its retrieval has landed, hit or confirmed miss),
  // this is a cheap synchronous stash read — no re-fetch. That matters
  // because a cold-start miss (retrieval lands just after the COLD_BUDGET_MS
  // wait gives up) must still surface once the background fetch completes,
  // even if the caller's query text never changes again within the request.
  async prepareMemories(
    sessionId: string,
    query: string,
    judge?: JudgeContext,
  ): Promise<MemoryEntry[]> {
    const st = this.sessionMemory(sessionId);
    const q = query.trim();
    if (q.length === 0) return st.stash;

    st.judge = judge;

    // Topic change → drop the stale set so we don't inject off-topic memories,
    // and invalidate the carried judge verdict (D15): a verdict is about a
    // topic, so the moment the topic moves the verdict stops applying.
    if (st.lastQuery && lexicalSimilarity(q, st.lastQuery) < TOPIC_SIM_MIN) {
      st.stash = [];
      st.resolved = false;
      st.judgedIds = null;
    }
    if (q !== st.lastQuery) {
      st.lastQuery = q;
      st.resolved = false;
    }
    const cold = st.stash.length === 0;
    if (!st.resolved) {
      this.kickPrefetch(st);
    }

    // Cold start: give the in-flight retrieval a brief chance to land.
    if (cold && st.inflight) {
      await Promise.race([st.inflight, delay(COLD_BUDGET_MS)]);
    }
    return st.stash;
  }

  // Background retrieval that fills a session's stash. Coalesced (one in flight
  // per session) and re-checks lastQuery so a mid-flight topic switch retries.
  //
  // The judge (D15) runs *here*, on the one-turn-behind path, which is what
  // makes it affordable: the loop never waits on it, and the cadence carry
  // below means it fires on a topic change rather than every user message.
  private kickPrefetch(st: SessionMemory): void {
    if (st.inflight) return;
    st.inflight = (async () => {
      try {
        for (let q = st.lastQuery; ; q = st.lastQuery) {
          const results = await this.retrieve(q);
          if (q === st.lastQuery) {
            st.stash = await this.applyJudge(st, q, results);
            st.resolved = true;
            return;
          }
        }
      } catch {
        // Keep the previous stash; nothing invalid gets injected. Leave
        // `resolved` false so a later call retries instead of getting stuck.
      } finally {
        st.inflight = null;
      }
    })();
  }

  /**
   * Filter a freshly retrieved candidate set through the judge (spec D15).
   *
   * Two paths, and the split is the whole cost story:
   *  - **Fresh verdict** when there is no carried one — a session's first
   *    message, or the first message after a topic change. One small call.
   *  - **Cadence carry** otherwise: reuse the previous verdict by keeping the
   *    candidates it approved. jcode classifies this as an intended non-LLM
   *    outcome rather than a degradation, and so do we — it rides a verdict
   *    that was made about this same topic.
   *
   * With no judge context configured this is the identity function, so the
   * whole feature is off by omission as well as by setting.
   */
  private async applyJudge(
    st: SessionMemory,
    query: string,
    candidates: MemoryEntry[],
  ): Promise<MemoryEntry[]> {
    const ctx = st.judge;
    if (!ctx || candidates.length === 0) return candidates;

    if (st.judgedIds) {
      this.lastDecision = "cadence_carry";
      return candidates.filter((e) => st.judgedIds?.has(memoryId(e.type, e.name)));
    }

    const { kept, decision } = await judgeMemories({
      query,
      candidates,
      provider: ctx.provider,
      model: ctx.model,
      complete: ctx.complete,
    });
    this.lastDecision = decision;
    // Only cache a verdict the judge actually produced. Caching a failure
    // would carry one transport error across a whole topic.
    if (decision === "judge_ran") {
      st.judgedIds = new Set(kept.map((e) => memoryId(e.type, e.name)));
    }
    return kept;
  }

  /**
   * Episode decay, with use raising the floor (spec D6).
   *
   *   score · max(floor(useCount), 0.5 ^ (ageDays / 30))
   *   floor(u) = min(0.9, 0.25 + 0.15 · ln(u + 1))
   *
   * **This diverges from jcode's formula and from D6 as originally written**,
   * which multiplied the decayed score by `1 + 0.1·ln(uses+1)`. That cannot do
   * what D6 claims. The arithmetic: decay spans 4× (a 0.25 floor against an
   * undecayed 1.0), while the log boost reaches only ~1.5× at 200 citations and
   * ~1.7× at 1000. A heavily-used year-old episode could never outrank an
   * ignored recent one, so the use term was decoration. The test that says so
   * is `episodes.test.ts`, "a heavily used old episode outranks an unused
   * recent one" — it failed against the original formula.
   *
   * Raising the *floor* instead encodes the intended meaning directly: use
   * protects an episode from sinking into irrelevance, without letting a log
   * term silently dominate ordering among episodes of similar standing. Age
   * still decides between two equally-used episodes, which is what recency is
   * for.
   *
   * **Semantic types are untouched.** "User prefers tables" does not get less
   * true, and demoting a durable fact for being old is how a system forgets a
   * standing instruction. Use is recorded for every type (D12) — it just does
   * not move semantic scores.
   */
  private adjustScore(entry: MemoryEntry, score: number): number {
    if (entry.type !== "episode") return score;

    const when = entry.happened_at
      ? Date.parse(entry.happened_at)
      : entry.createdAt;
    // A future or unparseable date must not manufacture a boost.
    const ageDays = Math.max(0, (Date.now() - when) / 86_400_000);
    const uses = this.usageFor(entry).useCount;
    const floor = Math.min(
      EPISODE_DECAY_CEILING,
      EPISODE_DECAY_FLOOR + 0.15 * Math.log(uses + 1),
    );
    return (
      score *
      Math.max(floor, Math.pow(0.5, ageDays / EPISODE_HALF_LIFE_DAYS))
    );
  }

  // The judge's most recent outcome, for the degradation-rate metric (D14/D15).
  lastJudgeDecision(): JudgeDecision | "cadence_carry" | "not_configured" {
    return this.lastDecision;
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
// Factory — one service per project, held in a bounded LRU. Services persist
// across turns (so per-session caches survive), but a long-running daemon that
// visits many projects won't retain them forever: the least-recently-used
// service is evicted and dispose()d (unregistering its change listener). The
// sidecar is on disk, so an evicted project is rebuilt cheaply on next use.
// =============================================================================

const MAX_PROJECT_SERVICES = 16;
const services = new Map<string, MemoryGraphService>();

export function getMemoryGraphService(projectPath: string): MemoryGraphService {
  const existing = services.get(projectPath);
  if (existing) {
    // LRU touch.
    services.delete(projectPath);
    services.set(projectPath, existing);
    return existing;
  }
  const service = new MemoryGraphService(getMemoryStore(projectPath));
  services.set(projectPath, service);
  while (services.size > MAX_PROJECT_SERVICES) {
    const oldest = services.keys().next().value as string | undefined;
    if (oldest === undefined) break;
    services.get(oldest)?.dispose();
    services.delete(oldest);
  }
  return service;
}

// Drop a session's prepared-memory cache from whichever project holds it.
// Call on session end so the per-session cache doesn't accumulate.
export function disposeSessionMemory(sessionId: string): void {
  for (const service of services.values()) service.disposeSession(sessionId);
}
