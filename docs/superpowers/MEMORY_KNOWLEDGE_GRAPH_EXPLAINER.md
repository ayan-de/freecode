# Memory Knowledge Graph — Full Explainer

> A complete walkthrough of the feature: what problem it solves, the concepts
> behind it, how each piece works, and what measurably changed before vs after.
> Written so you can explain it end-to-end in an interview.
>
> **Scope note (2026-08-09):** this covers the **retrieval** half. The write
> half — the `memory` tool, turn-end extraction, and its cost gates — landed
> later; see [`MEMORY_SYSTEM.md`](./MEMORY_SYSTEM.md) for the whole system,
> including how memories now get *created* in the first place.

---

## 0. The one-paragraph version (say this first)

FreeCode is an AI coding assistant with a **persistent memory** — little markdown
files that record facts about the user and project across sessions. The problem:
those memories were retrieved by dumb keyword match, and on the hot path the query
was literally *blank*, so it just grabbed "the first N files alphabetically." So
either we stuffed *every* memory into the prompt (expensive, doesn't scale) or we
injected a random slice (misses the relevant one). I built a **local semantic
retrieval layer**: each memory is turned into a vector (an embedding) using an
on-device model, the memories are linked into a **graph** (by tags, `[[wikilinks]]`,
and supersede relationships), and at each turn we find the memories semantically
closest to what the user is doing, then **walk the graph** to pull in their related
neighbours. It runs fully offline, never blocks the agent, degrades gracefully to
the old keyword path if the model isn't available, and the whole index is a
**derived sidecar** you can delete and rebuild from the markdown files at any time.

---

## 1. The concepts (the "new theory" you should be able to explain)

### 1.1 Embeddings & semantic similarity
An **embedding** is a fixed-length list of numbers (here 384 of them) that
represents the *meaning* of a piece of text. A model is trained so that texts with
similar meaning produce vectors that point in similar directions. "user prefers
pnpm" and "install dependencies with pnpm not npm" land close together even though
they share few exact words — that's the thing keyword search can never do.

We use **`all-MiniLM-L6-v2`**, a small, fast, well-known sentence-embedding model,
run locally through **ONNX** (via the `fastembed` library). ONNX is just a portable
format for running a trained neural net without needing Python/PyTorch — it ships a
native runtime we call from Node.

- **Cosine similarity**: to measure "how close" two vectors are, take the cosine of
  the angle between them. We L2-**normalize** every vector on the way in (scale it to
  length 1), which makes cosine similarity just a **dot product** — cheap. See
  `vector-store.ts:normalize` and `cosineTopK`.
- **top-k**: given the query vector, return the *k* most similar memory vectors.
  That's the seed set for retrieval.

### 1.2 Knowledge graph & cascade retrieval
Top-k alone finds memories that *look* like the query. But some relevant memories
share no words with it — they're relevant because they're *connected* to something
that matched. So we model memories as a **graph**:

- **Nodes**: `Memory`, `Tag`, `Cluster`.
- **Edges**: `HasTag` (memory→tag), `RelatesTo` (memory↔memory, from a `[[wikilink]]`
  in the body), `Supersedes` (a newer memory replaces an older), `Contradicts`, and
  `InCluster` (memory→auto-discovered cluster).

**Cascade retrieval** = seed with the top-k semantic hits, then do a **breadth-first
search (BFS)** outward up to 2 hops, accumulating a relevance score along the edges.
Each hop multiplies the score by the edge's weight and a **decay factor** (0.7), so
close neighbours count more than distant ones. This is how a memory you never
searched for "pops up" because it's tagged the same or wiki-linked from a hit —
mimicking how human memory surfaces related things by association.

Edge weights (`graph-types.ts`): `Supersedes 0.9`, `HasTag 0.8`, `RelatesTo 0.7`,
`InCluster 0.6`. `Contradicts` is weight **0** and skipped entirely — a
contradiction is a *negative* signal; traversing it should never boost relevance.

### 1.3 Clustering (k-means, deterministic)
Some memories are semantically similar but share no explicit tag or link. We group
them with **k-means** clustering over the embeddings (`clusters.ts`): pick k cluster
centers, assign each memory to its nearest center, recompute centers, repeat. This
adds `InCluster` edges so cascade can relay between them. The catch: k-means is
normally *random* (random starting centers → different clusters each run). We made
it **deterministic** — fixed random seed (`mulberry32(42)`), inputs sorted by id —
so rebuilding the index twice gives *identical* clusters. That determinism is a
correctness guarantee, not a nicety (see §4).

### 1.4 Derived sidecar index (source of truth stays human-readable)
The markdown files are the **single source of truth**. The vectors + graph live in a
`.graph/` sidecar folder that is **100% rebuildable** from those files. Delete it and
retrieval reconstructs itself. This is why the feature is a pure *enhancement* — it
touches none of the existing memory storage/IPC contract, and there's no migration
or risk of corrupting user data.

### 1.5 Eventual consistency / one-turn-behind (why it never slows the agent)
Embedding text through a neural net takes real milliseconds. We refuse to make the
user wait for that. Two mechanisms:
- **Fire-and-forget writes**: saving a memory schedules its embedding in the
  background (`void graph.onChange(...)`) — the save returns immediately. The index
  is *eventually consistent*: a just-saved memory might not have its vector for a
  moment, and that's fine (it's still reachable by keyword/graph until then).
- **One-turn-behind retrieval**: at turn N we inject the memories prepared from turn
  N-1's context and kick off turn N's retrieval in the background. The agent loop
  *never awaits* an embedding. (First message of a session is a "cold turn" — there's
  nothing prepared yet — so it waits a tiny 60ms budget, then proceeds.)

### 1.6 Graceful degradation (never break the loop)
The embedding model needs a native library. On minimal installs, arch mismatches, or
inside the compiled `build:bun` binary, that library may be missing. The design rule:
**memory must never throw into the agent loop.** The embedder catches the failure,
flips `available()` to `false` permanently, and everything falls back to the original
keyword-scorer + graph-walk path. Semantic search silently degrades; the agent keeps
working.

---

## 2. Architecture — how the pieces fit

```
User turn ──▶ agent/loop.ts ──▶ MemoryGraphService.prepareMemories(sessionId, text)
                                        │
             ┌──────────────────────────┼───────────────────────────┐
             ▼                          ▼                           ▼
        embedder.ts               vector-store.ts               graph-store.ts
     (text → 384-dim vec,       (packed f32 + meta,          (nodes+edges adjacency,
      lazy ONNX singleton)       cosine top-k seeds)          graph.json)
             │                          │                           ▲
             │                          ▼                           │
             │                     cascade.ts  ◀── builder.ts (files → tag/link/supersede edges)
             │                    (BFS, decay)      clusters.ts (k-means → InCluster edges)
             ▼
        secret-filter.ts (never embed credentials)

Source of truth: memory/<type>/*.md      Derived sidecar: memory/.graph/{graph.json, embeddings.bin, meta.json}
```

### File-by-file (all in `apps/core/src/memory/graph/`)

| File | Job | Key detail |
|------|-----|-----------|
| `graph-types.ts` | Node/Edge/weight definitions | `Contradicts = 0` (excluded from scoring) |
| `embedder.ts` | Lazy ONNX singleton, `embed()` / `available()` | Model loads on *first* embed, not at startup, so CLI stays fast; failure → permanent fallback |
| `vector-store.ts` | Packed `Float32Array` persistence + `cosineTopK` | Vectors stored **normalized**; content-hash gate skips re-embedding unchanged text; atomic write + checksum detect torn writes |
| `builder.ts` | Derive graph from files (deterministic, **no model**) | `[[wikilink]]`→RelatesTo, tags→HasTag, `supersedes`→Supersedes; dangling links skipped |
| `graph-store.ts` | Map-based adjacency, `graph.json` load/save | Treats edges as **undirected** for traversal; schema-version guard → rebuild on mismatch |
| `cascade.ts` | BFS from seeds, depth ≤ 2, decay 0.7 | Only `Memory` nodes score; Tags/Clusters are relay hubs; `Contradicts` skipped |
| `clusters.ts` | Deterministic k-means → `InCluster` edges | Fixed seed + sorted input ⇒ reproducible clusters |
| `secret-filter.ts` | Block credentials from being embedded | Regexes for API keys, private keys, `.env`-style assignments |
| `index.ts` | `MemoryGraphService` facade | Single entry point; per-session one-turn-behind cache; single-flight write queue; LRU eviction |

### Integration points (surgical — 3 small edits to existing code)
1. `mem-types.ts` — added optional `tags?: string[]` to frontmatter (back-compatible;
   absent = no tags).
2. `mem-store.ts` — after `save`/`delete`, emit a change event; the graph service
   registers via `onMemoryChange` and does fire-and-forget embedding.
3. `agent/loop.ts` — inject the retrieved memory block into the system prompt.

`server.ts` + CLI add `memory graph rebuild` / `memory graph stats` for maintenance.

---

## 3. How a single retrieval actually flows (trace it end-to-end)

1. `prepareMemories(sessionId, userText)` is called at prompt-build.
2. If the new text is very different from last turn's (Jaccard token overlap <
   `0.12`), it's treated as a **topic change** → the stale surfaced set is dropped.
3. A background prefetch (`kickPrefetch`) is kicked. Warm turns return last turn's
   stash *instantly*; a cold turn waits ≤ 60ms for the fresh one.
4. Inside `retrieve()`:
   - `sync(entries)` brings the index in line with the files: rebuild base edges if
     tags/links changed, embed any new/changed memory, recompute clusters if the
     vector set changed. All cheap-skipped via signatures/content-hashes if nothing
     changed.
   - `seed(query)`: embed the query → `cosineTopK` (top 10, cosine ≥ 0.4). If the
     embedder is unavailable or returns nothing → **keyword fallback**.
   - `cascadeRetrieve(seeds, graph)`: BFS 2 hops, accumulate decayed scores.
   - Sort, take top 8, load those memory entries, return them.
5. Anything throws anywhere → fall back to the old `findRelevantMemories`. The loop
   never sees an error.

---

## 4. Correctness guarantees baked in (the "senior" details)

These are the things that make it production-safe, and each has a test:

- **Torn-write safety**: `.graph/` files are written temp-then-rename (atomic), and
  `meta.json` carries a **sha256 checksum of `embeddings.bin`** plus expected byte
  size. If a crash leaves vectors and metadata from different generations, the
  mismatch is caught on load and the sidecar is discarded → rebuilt from files.
- **Single-flight write queue**: concurrent saves are serialized so they can't
  interleave and corrupt the sidecar.
- **Determinism**: k-means uses a fixed seed and sorted input; edges are deduped and
  neighbours sorted; name resolution is order-independent. Rebuild → identical
  retrieval over the deterministic edges. (Success criterion in the spec.)
- **Secrets never embedded**: `containsSecret` runs before every embed; a
  secret-bearing memory gets a graph node but no vector, and any stale vector is
  purged.
- **Never throws into the loop**: every failure path (`embed`, `sync`, `retrieve`,
  `onChange`) is caught and degrades. Verified by a "fallback with embedder
  uninstalled" test.
- **No memory leaks in the long-running daemon**: services are LRU-bounded (16
  projects), each `dispose()`s its change-listener on eviction; per-session caches
  are LRU-bounded (64) and dropped on session end.

Test files present: `builder.test.ts`, `cascade.test.ts`, `clusters.test.ts`,
`vector-store.test.ts`, `secret-filter.test.ts`, `service-lifecycle.test.ts`,
`session-memory.test.ts`, `topic.test.ts`.

---

## 5. Before vs After (this is what the recruiter wants)

| Dimension | **Before** | **After** |
|-----------|-----------|-----------|
| **Hot-path retrieval** | `buildMemoryPrompt` called `findRelevantMemories("")` — a **blank query** — which degrades to "first N memories alphabetically." Effectively random. | Semantic top-k over embeddings of the *current context*, expanded by graph cascade. Relevant memories actually surface. |
| **Relevance model** | Substring/keyword match only. Misses paraphrases and synonyms. | Meaning-based (embeddings) + associative (graph neighbours). Finds memories that share *no words* with the query. |
| **Token cost** | Inject **everything** (bloats, breaks past a few dozen memories) or an arbitrary slice. | Inject only *k* relevant memories + neighbours. Cost bounded regardless of store size. |
| **"Related" memories** | No concept of relatedness at all. | `[[wikilinks]]`, tags, supersedes, and clusters form a graph; cascade pulls in connected memories. |
| **Latency impact on the agent** | N/A (it was trivial and useless). | **Zero on the hot path** — embedding is fire-and-forget, retrieval is one-turn-behind. |
| **Privacy** | Files local, but no semantic layer. | Fully on-device ONNX, no network, no API key; secrets filtered out before embedding. |
| **Scalability** | Linear scan of all memories each turn; unusable at scale. | O(changed files) re-embedding; retrieval bounded by `k × branching × depth`, not store size. |
| **Resilience** | — | Derived sidecar rebuildable from files; atomic writes; graceful fallback to the old keyword path if the model is missing. |

### What *improved*, in plain terms
1. **The model actually remembers the right things** — the #1 user-visible win.
   Before, cross-session memory was barely on the hot path and what it did inject was
   arbitrary.
2. **It scales** — you can accumulate hundreds of memories without blowing the token
   budget or slowing turns.
3. **It's invisible when it works and invisible when it breaks** — no latency added,
   and it silently degrades instead of erroring.
4. **Fewer wasted turns** — surfacing related memories (cascade) means the model
   re-derives less and asks fewer redundant questions.

---

## 6. Honest limitations (say these — it signals maturity)

- Semantic retrieval runs on the `node`/npm path, **not inside the compiled
  `build:bun` binary** — that binary can't load onnxruntime's native lib, so it
  degrades to keyword+graph. Documented trade-off; a WASM backend is the future fix.
- Topic-change detection on the hot path uses a cheap **lexical** (word-overlap)
  proxy, not a real embedding cosine, because the real embed runs off the hot path.
- Clusters refresh periodically, not per-write (k-means over everything is O(n)).
- The index is *eventually* consistent — a memory saved this turn may not have its
  vector for a moment (reachable by keyword/graph meanwhile).

---

## 7. If they ask "why did you build it this way?"

- **Local ONNX, not an embedding API** → privacy (memories are personal), no key, no
  network latency, works offline.
- **Derived sidecar, not a schema change** → zero migration risk; markdown stays the
  human-editable, git-friendly source of truth; delete-and-rebuild is the recovery
  story.
- **Graph on top of embeddings, not embeddings alone** → captures *associative*
  relevance (tags/links/clusters) that pure similarity misses; mirrors how memory
  actually surfaces related things.
- **Fire-and-forget + one-turn-behind** → the hard constraint was "never add latency
  to a turn," and this is the standard way to get semantic recall without paying for
  it synchronously.
- **Graceful degradation everywhere** → an assistant that crashes because an optional
  ML dependency is missing is worse than one with slightly weaker recall.

Prior art / inspiration: I modelled this on **my own `jcode` project** (Rust,
`petgraph`) — same cascade + async one-turn-behind shape — reimplemented here in
TypeScript and trimmed to what FreeCode needed.

---

## 8. How I built it — the commit story (the "how" answer)

I shipped it in **phases, each independently working** — the spec's rule was "every
phase leaves the agent loop functional via the fallback path." That's why there was
never a broken `main`. Reading oldest → newest, starting at `d45c04a`:

| Commit | Phase | What it added |
|--------|-------|---------------|
| `d45c04a` | **Phase 1 — semantic retrieval** | The foundation: `embedder.ts` (lazy ONNX), `vector-store.ts` (packed f32 + cosine top-k), `MemoryGraphService` skeleton, the `mem-store` **change-notification** system, and the `agent/loop.ts` injection + `renderRetrievedMemories`. At this point retrieval was already semantic, no graph yet. |
| `4c35d85` | **Phase 2 — graph + cascade** | `graph-types`, `graph-store` (adjacency), `builder` (files → tag/wikilink/supersede edges), `cascade` (BFS + decay). Top-k became a graph walk. |
| `ff99f06` | **Phase 3 — clusters** | Deterministic k-means (`clusters.ts`) + `InCluster` edges, with tests for reproducibility. |
| `df3153d` | **Phase 4 — async / topic** | One-turn-behind injection + lexical **topic-change detection** so a subject switch drops the stale surfaced set. |
| `0132e06` | **Phase 5 — surface + privacy** | CLI `memory graph rebuild/stats`, `secret-filter.ts` so credentials are never embedded. |
| `c6b042d`, `5b5b13c` | docs | Wrote the spec + plan, marked status implemented. |
| `a7c6418` | hardening | Moved `fastembed` to **optionalDependencies** — the whole point of graceful degradation is that a missing native ML dep can't break install. |
| `4c35d85`→`fe56af2` | polish | `2d067bb` per-session cache (two sessions in one project can't clobber each other's surfaced set), `fe56af2` `dispose()` to unregister listeners and stop the long-running daemon leaking memory. |

The through-line to emphasise: **each commit is a shippable slice**, the risky
external dependency (the ONNX model) was de-risked *first* and made optional, and the
last commits are all about lifecycle correctness in a long-running process — not
features, but the difference between a demo and something that survives a daemon
running for days.
