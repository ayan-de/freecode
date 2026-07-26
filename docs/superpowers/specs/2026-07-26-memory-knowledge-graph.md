# Memory Knowledge Graph

**Date:** 2026-07-26
**Status:** Implemented (2026-07-27) — all phases live in `apps/core/src/memory/graph/`
**Supersedes:** none (extends `2026-06-02-memory-session-design.md`)
**Companion plan:** `docs/superpowers/plans/2026-07-26-memory-knowledge-graph.md`
**Prior art:** jcode `docs/MEMORY_ARCHITECTURE.md` (Rust, petgraph); gap item #1 in
`docs/superpowers/plans/2026-07-18-jcode-feature-gap-analysis.md`.

---

## 1. Problem

FreeCode's persistent memory is a flat set of markdown files
(`memory/mem-store.ts`, types `user | feedback | project | reference`) with two weak spots:

1. **Retrieval is keyword-only and, on the hot path, effectively random.**
   `buildMemoryPrompt` (`mem-prompt.ts:25`) calls `findRelevantMemories("")` — a
   *blank* query — which `mem-query.ts:64` degrades to "first N alphabetically."
   There is no semantic relevance and no notion of *related* memories.
2. **Persistent memory is barely on the hot path.** The agent loop only injects
   `MemoryService` (compaction/session summaries) at `agent/loop.ts:536`. The
   cross-session store is reached only via IPC / the memory tool, so the model
   must *choose* to recall — it rarely does.

Consequence: either we inject **everything** (token bloat, doesn't scale past a
few dozen memories) or we inject an **arbitrary slice** (misses the relevant one).

## 2. Goals

- **Cut tokens per turn**: inject only the *k* memories relevant to the current
  context, plus their graph neighbours — not the whole store.
- **Better recall → fewer turns**: surface related memories the model wouldn't
  have thought to ask for (cascade traversal), so it re-derives less.
- **Local & private**: retrieval runs fully on-device (ONNX embeddings), no
  network round-trip, no API key, secrets never embedded.
- **Scalable**: O(changed files) re-embedding, incremental graph updates, retrieval
  bounded regardless of store size.
- **Maintainable**: markdown files stay the human-readable source of truth; the
  graph + vectors are a *derived, rebuildable* sidecar index.

### Non-goals (this spec)

- Session indexing (past transcripts) and code-symbol graphs — separate specs.
- Provider/API embeddings — decided against; local ONNX only.
- Sleep-like global consolidation / ambient mode (jcode Phase 8) — future.

## 3. Key design decisions

### D1 — Files are the source of truth; the index is derived

Markdown files under `~/.freecode/projects/<slug>/memory/<type>/*.md` remain
canonical (git-friendly, user-editable, matches current `MemoryStore`). The graph
and embeddings live in a **sidecar index** that can be deleted and rebuilt from
files at any time. This keeps the existing IPC/tool surface untouched and makes
the KG a pure enhancement, not a migration.

```
~/.freecode/projects/<slug>/memory/
├── <type>/*.md              # SOURCE OF TRUTH (unchanged)
├── MEMORY.md                # index (unchanged)
└── .graph/                  # DERIVED sidecar — safe to delete & rebuild
    ├── graph.json           # nodes + edges (adjacency)
    ├── embeddings.bin       # packed f32 vectors, keyed by content hash
    └── meta.json            # model id, dims, schema version, hash→id map
```

### D2 — Local ONNX embeddings, content-hash cached

Embed via **`fastembed`** (Node; `Anush008/fastembed-js`, bundles
onnxruntime-node) — falls back gracefully if unavailable (see D6). The embedder
is a **lazy singleton**: model loads on first retrieval, not at startup, so cold
CLI launches stay fast.

**Model choice — verify before building.** Target `all-MiniLM-L6-v2` (384-dim),
but `fastembed-js`'s default is `BGEBaseEN`. A pre-implementation task
(Plan §0) must confirm MiniLM is present in its `EmbeddingModel` enum. If it is
not, fall back to whatever 384-dim MiniLM variant it ships, or accept `BGEBaseEN`
(768-dim) and set vector dims from the model at runtime — **`meta.json.dims` is
read from the loaded model, never hard-coded.** Prefer a **quantized (int8)**
MiniLM if `fastembed-js` bundles one: ~25 MB vs ~90 MB fp32, cutting first-run
download 3–4× for negligible recall loss.

**Content-hash cache.** Each memory's embedding is keyed by `sha256(content)`
(the `content-hash-cache-pattern`): unchanged files are never re-embedded.

**Re-embedding is non-blocking (resolves the save-latency question).**
`MemoryStore.save`/`delete` fire `void graph.onChange(entry)` —
**fire-and-forget, never awaited**. A `save()` must never block on an ONNX embed
(that is exactly the latency regression the memory-footprint work avoids
elsewhere). Consequence: the index is *eventually consistent*. A memory saved
this turn may not yet have a vector when Phase-1 synchronous retrieval runs; that
entry is still reachable via the keyword/wikilink/tag path (D6) and gets its
vector on the next `onChange` drain. `onChange` serializes writes to `.graph/`
through a single-flight queue so concurrent saves can't corrupt the sidecar.

### D3 — Graph model (mirrors jcode, trimmed)

Nodes: `Memory`, `Tag`, `Cluster`. Edges:

| Edge          | From → To        | Source                                    |
| ------------- | ---------------- | ----------------------------------------- |
| `HasTag`      | Memory → Tag     | frontmatter tags + inferred               |
| `RelatesTo`   | Memory → Memory  | `[[wikilink]]` in body + embedding sim    |
| `Supersedes`  | Memory → Memory  | explicit link / write-time detection      |
| `Contradicts` | Memory → Memory  | write-time detection (flag, keep both)    |
| `InCluster`   | Memory → Cluster | HDBSCAN/k-means over embeddings (Phase 3) |

Note freecode memory bodies **already use `[[name]]` wikilinks** (see the memory
convention in the global guide) — these become `RelatesTo` edges for free, no
model needed. Tags are a *new, optional* frontmatter field (back-compatible).

### D4 — Cascade retrieval (BFS), same shape as jcode

```
retrieve(context, k):
  seeds   = cosineTopK(embed(context), K_INITIAL)      # e.g. 10, threshold 0.4
  visited = {}; out = seeds
  BFS from seeds, depth ≤ 2:
    for each edge: score = edgeWeight * decay^depth     # decay 0.7
    accumulate Memory neighbours
  return topK(out, k)                                   # e.g. 8
```

Edge weights: `Supersedes 0.9`, `HasTag 0.8`, `RelatesTo w`, `InCluster 0.6`.
Bounded by `K_INITIAL` and `depth`, so cost is independent of store size.

**`Contradicts` is excluded from cascade scoring.** A contradiction is a
*negative* signal — traversing it should not boost a neighbour's relevance. The
edge is stored (D3) purely for the memory tool / UI and for write-time conflict
surfacing; `cascade.ts` skips it entirely. (If a superseding memory exists, the
`Supersedes` edge already routes retrieval to the current one.)

### D5 — Async, one-turn-behind injection (jcode's non-blocking model)

**Phase 1** is synchronous: at prompt-build, embed the last user message, run
retrieval, inject. Simple, correct, adds ~embedding latency to turn 1 only
(model cached after).

**Phase 4** upgrades to jcode's pattern: retrieval runs in the background off the
*previous* turn's context; results from turn N are injected at turn N+1. The
main loop never blocks on memory. This is the "make it fast" payoff.

The prepared-memory cache is **per session**, not per project — the graph/vector
index is shared per project, but two sessions in the same project must never
clobber each other's surfaced set. It lives in the durable per-project
`MemoryGraphService` keyed by `sessionId` (the `AgentLoop` is recreated each
`session.send`, so it can't hold cross-turn state), LRU-bounded, and dropped on
`session.delete`. A **cold turn** — a session's first message, or immediately
after a topic change clears the set — waits a small budget (~60 ms) for the
fresh retrieval before falling back to background, so one-shot prompts aren't
starved of memory; warm turns return the prior set instantly and refresh behind
the request.

### D6 — Graceful degradation (never break the loop)

If `fastembed`/onnxruntime is unavailable (e.g. minimal install, arch mismatch),
retrieval **falls back to the existing keyword scorer + wikilink/tag graph walk**
(no vectors). Memory must never throw into the agent loop. The graph traversal
alone already beats today's blank-query behaviour.

**The self-contained `build:bun` release binary is one such environment.**
`bun build --compile` bundles the JS but not onnxruntime's sibling native
`libonnxruntime.so.*`, so the embedder fails to load *inside the binary*
(`libonnxruntime.so.1: cannot open shared object file`). This is handled, not
fixed: the first embed marks the backend permanently unavailable and retrieval
degrades to the keyword/graph path. **Semantic retrieval therefore runs only on
the `node` / npm-installed core path, not the compiled binary** (decision:
ship as-is; a WASM backend that bundles cleanly is the future option). Because
the failure is at ONNX *run* time rather than import time, `embed()` must flip
`available()` to `false` on error and `sync()` must swallow it — otherwise
`memory.graph.rebuild` / IPC would surface a hard error instead of degrading.

## 4. Module layout (`apps/core/src/memory/graph/`)

Each file does one thing (project rule: ~150 lines, decompose):

| File              | Responsibility                                                                   |
| ----------------- | ---------------------------------------------------------------------------------|
| `graph-types.ts`  | `GraphNode`, `EdgeKind`, `RetrievalResult` types                                 |
| `embedder.ts`     | Lazy ONNX singleton; `embed(text): Promise<Float32Array>`; keyword fallback flag |
| `vector-store.ts` | Packed f32 persistence + `cosineTopK`; content-hash cache                        |
| `graph-store.ts`  | Adjacency (`Map`-based), add/remove node & edge, `graph.json` load/save          |
| `builder.ts`      | Build/sync graph from `MemoryStore`: wikilinks→`RelatesTo`, tags→`HasTag`        |
| `cascade.ts`      | BFS `cascadeRetrieve(contextEmbedding, opts)`                                    |
| `index.ts`        | `MemoryGraphService` facade (what the loop/IPC call)                             |

`MemoryGraphService` is the single entry point; the loop and IPC never touch
internals (DIP). It wraps the existing `MemoryStore` rather than replacing it.

## 5. Integration points (minimal, surgical)

1. `mem-types.ts` — add optional `tags?: string[]` to frontmatter parse/serialize
   (back-compatible; absent = no tags).
2. `mem-store.ts` — after `save`/`delete`, `void graph.onChange(entry)` —
   **fire-and-forget, not awaited** (D2), non-throwing, single-flight queued.
   Keeps the sidecar incremental without adding embed latency to writes.
3. `mem-query.ts` — `findRelevantMemories` gains a graph-backed path; keyword path
   stays as the fallback (D6). Same signature — callers unchanged.
4. `agent/loop.ts:536` — build a *memory* context block from
   `MemoryGraphService.retrieve(lastUserText)` and add it to the system blocks,
   alongside the existing `MemoryService` (compaction) block. Phase 4 makes it async.
5. `server.ts` — `memory.query` routes through the graph service; add
   `memory.graph.rebuild` (maintenance) and `memory.graph.stats`.

## 6. Scalability & maintenance

- **Re-embed cost**: O(1) per save (only the changed entry); full rebuild is
  O(n) and offered as an explicit `memory.graph.rebuild` command.
- **Retrieval cost**: bounded by `K_INITIAL × branching × depth`, not store size.
- **Vector storage**: packed `Float32Array` in one `embeddings.bin`, no per-file
  overhead. Sizing is **MiniLM-only** (384 × 4 B ≈ 1.5 KB/memory; 1k ≈ 1.5 MB) —
  an *estimate, not a guarantee*: on a BGE fallback (768-dim) it doubles. Dims come
  from `meta.json.dims` (read from the loaded model, D2); `vector-store.ts` must
  carry a one-line comment so nobody hard-codes 384 out of habit.
- **Atomic sidecar writes**: every `.graph/` file (`graph.json`, `embeddings.bin`,
  `meta.json`) is written **write-temp-then-rename** so a mid-drain crash can't
  leave a torn file that *looks* valid. On load, a torn/invalid sidecar (bad hash
  map, size/dims mismatch vs `meta.json`) is treated as corrupt and triggers
  rebuild-from-files — safe because files are the source of truth (D1).
- **Schema versioning**: `meta.json.schemaVersion` + `modelId`; on mismatch,
  auto-rebuild from files (files are truth, so this is always safe).
- **Binary size**: onnxruntime + model is the real cost — ~90 MB fp32, but
  **~25 MB for an int8-quantized MiniLM** (prefer it, D2). Ship the model as a
  lazy download on first use (cached in `~/.freecode/models/`), *not* baked into
  the bun binary — keeps `pnpm build:bun` slim.

## 7. Privacy

Reuse jcode's rule set: never embed/store secrets. Before embedding, run the
existing secret filters (API keys, `.env`, `.gitignore`'d content). Vectors live
locally only; nothing leaves the machine.

## 8. Success criteria

- Turn-level injected memory tokens **drop** vs. `includeAll`, while a seeded
  "relevant memory" test set is retrieved in top-k (precision/recall harness).
- Retrieval p50 < 20 ms after warm-up on a 500-memory store.
- Deleting `.graph/` and rerunning reproduces identical retrieval **over the
  deterministic edges** (`HasTag`/`RelatesTo`/`Supersedes` + embedding top-k).
  `InCluster` (Phase 3) is excluded from this guarantee unless clustering is made
  deterministic — k-means must use a **fixed seed** and HDBSCAN **pinned params**;
  otherwise rebuilds may reshuffle clusters and perturb edge-case top-k.
- Loop never throws when embeddings are unavailable (fallback path test).
- `pnpm build:bun` size unchanged (model is lazy-downloaded, not bundled).
