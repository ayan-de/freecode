# Plan: Memory Knowledge Graph

> **Date:** 2026-07-26
> **Spec:** `docs/superpowers/specs/2026-07-26-memory-knowledge-graph.md`
> **Status:** Implemented (2026-07-27) — all phases (0–5) shipped in `apps/core/src/memory/graph/`.
> **Scope (locked):** KG over persistent memory (`mem-store.ts`), local ONNX embeddings.

Each phase is independently shippable and leaves the loop working (D6 fallback).
File sizes target ~150 lines (project rule). Verify criteria before advancing.

---

## Phase 0 — De-risk spike (do first, ~half day)

Resolves the two facts the spec depends on but can't assert:

1. **`fastembed-js` model enum.** Install `fastembed`, list `EmbeddingModel`.
   Confirm an `all-MiniLM-L6-v2` (384-dim) entry exists and whether a **quantized**
   variant ships. → verify: a 5-line script embeds two strings, prints dims and
   model id. If MiniLM absent, record the chosen 384-dim substitute (or accept
   BGE-768 and make dims runtime-driven).
2. **Bun compatibility.** onnxruntime-node loads native `.node` addons — confirm
   it runs under the `pnpm build:bun` binary *and* plain node. → verify: embed
   works in both; if it fails under bun, decide `transformers.js` (wasm) fallback
   *now*, before building against `fastembed`.

**Gate:** do not start Phase 1 until the embedder backend + dims are pinned in
`meta.json` schema.

---

## Phase 1 — Embeddings + vector retrieval (synchronous), no graph yet

Delivers the token win immediately; graph edges come in Phase 2.

1. `memory/graph/embedder.ts` — lazy singleton; `embed(text): Promise<Float32Array>`;
   `available(): boolean`. Lazy-downloads model to `~/.freecode/models/`.
2. `memory/graph/vector-store.ts` — packed f32 `embeddings.bin` + `meta.json`
   (hash→id, dims, modelId, schemaVersion); `cosineTopK(vec, k, threshold)`;
   content-hash cache.
3. `mem-store.ts` — `void graph.onChange(entry)` after save/delete (fire-and-forget,
   single-flight queue, non-throwing).
4. `mem-query.ts` — `findRelevantMemories` gains a vector path; **keyword path stays
   as fallback** when `!embedder.available()` or no vectors yet. Signature unchanged.
5. `agent/loop.ts` (~536) — inject a memory block from top-k over the last user
   message, next to the existing `MemoryService` block.

**Verify:** injected memory tokens drop vs `includeAll` on a seeded set while the
planted relevant memory lands in top-k; loop still runs with `fastembed` uninstalled
(fallback test); deleting `.graph/` rebuilds identical top-k.

---

## Phase 2 — Graph edges + cascade retrieval

Turns top-k into jcode-style cascade.

1. `memory/graph/graph-types.ts` — `GraphNode` (Memory|Tag), `EdgeKind`
   (`HasTag`/`RelatesTo`/`Supersedes`/`Contradicts`), `RetrievalResult`.
2. `mem-types.ts` — add optional `tags?: string[]` to frontmatter parse/serialize
   (back-compatible: absent = none).
3. `memory/graph/graph-store.ts` — Map-based adjacency; add/remove node+edge;
   `graph.json` load/save; schema-version guard → auto-rebuild on mismatch.
4. `memory/graph/builder.ts` — build/sync from `MemoryStore`: `[[wikilink]]`→
   `RelatesTo`, `tags`→`HasTag`, explicit supersede links→`Supersedes`. **No model
   needed for edges** — cheap and deterministic.
5. `memory/graph/cascade.ts` — BFS depth ≤ 2, edge weights per spec D4,
   depth decay 0.7; **skips `Contradicts`**.
6. `memory/graph/index.ts` — `MemoryGraphService` facade: `retrieve()`, `onChange()`,
   `rebuild()`, `stats()`. Loop/IPC call only this.

**Verify:** a memory reachable only via `RelatesTo` from a seed is retrieved when
the seed matches; cascade cost flat as store grows 10×; `Contradicts` never boosts
a neighbour into top-k.

---

## Phase 3 — Clusters (optional, deterministic)

1. `memory/graph/clusters.ts` — k-means (**fixed seed**) or HDBSCAN (**pinned
   params**) over embeddings → `Cluster` nodes + `InCluster` edges; periodic
   refresh, not per-write.
2. Fold `InCluster` (weight 0.6) into cascade.

**Verify:** two rebuilds on the same store produce identical clusters (determinism);
adding clusters improves recall on the seeded set without hurting precision.

---

## Phase 4 — Async, one-turn-behind injection

The "make it fast" payoff (spec D5).

1. Move retrieval off the hot path: after turn N, kick background retrieval on
   turn N's context; stash result; inject at turn N+1. Main loop never awaits embeds.
2. Topic-change reset: clear stale surfaced set when context similarity drops
   (jcode's < 0.3 heuristic).

**Verify:** turn latency shows no embedding cost after warm-up; retrieval p50
< 20 ms on a 500-memory store; injected set tracks conversation topic shifts.

---

## Phase 5 — Maintenance surface & polish

1. `server.ts` IPC: `memory.graph.rebuild`, `memory.graph.stats`; route
   `memory.query` through the service.
2. CLI: `freecode memory graph rebuild|stats`.
3. Secret filter before embedding (spec §7): reuse existing secret/`.env`/gitignore
   checks; add a test that a secret-bearing memory is never embedded.
4. Docs: update `2026-06-02-memory-session-design.md` cross-ref; note `.graph/` in
   the storage layout.

**Verify:** `rebuild` reproduces retrieval from files alone; secret-filter test green.

---

## Risks & mitigations

| Risk                                   | Mitigation                                              |
| -------------------------------------- | ------------------------------------------------------ |
| `fastembed` MiniLM/bun incompat        | Phase 0 gate; `transformers.js` (wasm) fallback ready  |
| Embed latency on writes                | Fire-and-forget `onChange`, eventual consistency (D2)  |
| Non-deterministic clusters             | Fixed seed / pinned params; excluded from determinism SC |
| Binary bloat                           | Lazy model download, prefer int8 (~25 MB), never bundled|
| Contradiction boosting wrong memory    | `Contradicts` excluded from cascade scoring (D4)       |
| Sidecar corruption on concurrent saves | Single-flight write queue in `onChange`                |
| Torn write on mid-drain crash          | Atomic write-temp-then-rename; corrupt load → rebuild-from-files (D2) |
