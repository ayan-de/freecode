# FreeCode Memory — Complete Implementation Reference

> Everything about persistent memory in one place: what's on disk, how a memory
> is born, how one gets retrieved, every constant and where it lives, what's
> deliberately absent, and how to debug it.
>
> **Scope.** This is the *implementation* reference. For the conceptual
> walkthrough of embeddings, cosine similarity, and cascade retrieval, read
> [`MEMORY_KNOWLEDGE_GRAPH_EXPLAINER.md`](./MEMORY_KNOWLEDGE_GRAPH_EXPLAINER.md)
> first — it teaches the ideas; this documents the machine.
>
> **Specs:** read side `specs/2026-07-26-memory-knowledge-graph.md` ·
> write side `specs/2026-08-09-memory-write-path.md` ·
> viewer `specs/2026-08-04-memory-graph-explorer-design.md`
>
> Last updated 2026-08-09.

---

## 1. The shape of the whole thing

Memory has two halves that meet at a directory of markdown files.

```
                        ┌──────────────────────────────┐
   WRITE                │   markdown files on disk     │              READ
                        │   (the source of truth)      │
 memory tool ──────────▶│                              │──────▶ MemoryGraphService
 (model's choice)       │  memory/<type>/<name>.md     │           .prepareMemories()
                        │  memory/MEMORY.md            │                 │
 extract.ts ───────────▶│                              │                 ▼
 (turn-end mining)      └──────────────┬───────────────┘        system prompt block
                                       │                         "# Relevant memories"
                          onMemoryChange│ (fire-and-forget)
                                       ▼
                        ┌──────────────────────────────┐
                        │  .graph/ — derived sidecar   │
                        │  embeddings.bin · graph.json │
                        │  meta.json                   │
                        │  DELETE IT ANY TIME          │
                        └──────────────────────────────┘
```

**The invariant that makes everything else safe:** the markdown files are the
only source of truth. `.graph/` is derived, and `MemoryStore.list()` reads the
filesystem directly (`mem-store.ts:146`), so anything that writes a valid file —
including you, by hand — is picked up on the next sync. Corruption, schema
changes, and model changes are all resolved by deleting `.graph/` and rebuilding.

---

## 2. On-disk layout

```
~/.freecode/projects/<basename-of-project-path>/memory/
├── user/*.md          who they are, how they like to work
├── feedback/*.md      guidance they gave you
├── project/*.md       decisions, constraints, deadlines
├── reference/*.md     pointers to external systems
├── MEMORY.md          generated index — never hand-edit
└── .graph/            derived, rebuildable
    ├── graph.json     nodes + edges
    ├── embeddings.bin packed f32 vectors
    └── meta.json      modelId, dims, schemaVersion, hash→id map
```

**The project key is `path.basename(projectPath)`, sanitized** — not the full
path (`mem-store.ts:31`). Two projects both named `api` in different parent
directories **share one memory store**. This is a real limitation, not a
subtlety; see §10.

A memory file:

```markdown
---
name: prefers-tables
description: User wants comparisons rendered as tables
type: feedback
tags: style, formatting
supersedes: old-formatting-note
---
Render comparisons as markdown tables.

**Why:** easier to scan than prose.
**How to apply:** any time you compare 2+ options. See [[response-style]].
```

`tags` and `supersedes` are optional and back-compatible (absent = none). Both
are parsed at `mem-types.ts:100-101` and feed graph edges. `[[wikilinks]]` in the
body become `RelatesTo` edges for free — no model involved.

---

## 3. The write path

### 3.1 The `memory` tool — `tools/memory.ts`

```
memory(action: "save",   type, name, description, content, tags?, supersedes?)
memory(action: "delete", type, name)
memory(action: "list",   type?)
```

**Always routes through `MemoryStore`, never raw `fs`.** That is the whole point
of the tool existing rather than telling the model to use `write`:

| via `MemoryStore.save()` | via raw `write` |
| --- | --- |
| frontmatter serialized from a typed entry | model hand-writes YAML; typos degrade it silently |
| `updateIndex()` refreshes `MEMORY.md` | index goes stale |
| `emitMemoryChange()` → incremental embed + edges | no event; only self-heals on the next full `sync()` |

Behaviours worth knowing:

- **Idempotent on `(type, name)`.** Saving an existing name updates it and the
  result reports `outcome: "updated"` plus the previous description, so the model
  can tell it clobbered something.
- **Refuses secrets** via `containsSecret()`. See §6.
- **`list` returns names + descriptions only, never bodies** — it is a dedup
  check before saving, not a recall path. Recall is the graph's job.
- **Coerces `tags`/`supersedes` from comma-separated strings**, because
  strict-decoding providers send lists that way.

### 3.2 Turn-end extraction — `memory/extract.ts`

Fires at `agent/loop.ts`'s `complete("Done", …)` branch — the model answered with
no further tool calls, after the verifier gate. That is the exact analogue of
claude-code's trigger.

```
completion → shouldExtract() gates → one provider.execute() call
           → JSON array of proposals → validate → cap at 3 → MemoryStore.save()
```

- **Fire-and-forget.** Never awaited. The user's result returns first.
- **Capped at `MAX_SAVES_PER_RUN = 3`.** There is no consolidation pass, so an
  unbounded extractor fills the store faster than anything cleans it.
- **Transcript clipped to 12,000 chars**, text parts only (tool args and results
  are the "how"; we want what was said and concluded).
- **Never throws.** Malformed JSON, a dead provider, a fenced code block, an
  unknown `type` — all degrade to "saved nothing".

**Why a one-shot call and not a subagent:** `SubagentType` (`agent/types.ts:38`)
is a closed union of five types with no tool allowlist, so "allow only the memory
tool" is not expressible through `executeSubagent`. Parsing proposals ourselves
is also what makes the cap deterministic rather than a request the model may
ignore. Same shape as jcode's `Sidecar::extract_memories`.

**Subagents never extract.** `executeSubagent` passes `memoryExtraction: false`
(`AgentLoopConfig`, default `true`). Their transcript is delegated machine work,
and without this every verifier/explorer/reviewer would fire its own extraction,
turning one user turn into several calls.

### 3.3 The gates — `memory/extract-policy.ts`

Extraction is a **fresh, full-price provider call**. claude-code runs one every
turn only because its forked agent rides the parent's prompt cache; we have no
forked-agent primitive, so we follow jcode's cadence instead.

`shouldExtract()`, cheapest first:

| # | Gate | Constant | Prior art |
| - | ---- | -------- | --------- |
| 1 | Env kill switch | `FREECODE_DISABLE_MEMORY_EXTRACTION` | claude-code `isAutoMemoryEnabled` |
| 2 | Settings kill switch | `memory.autoExtract` | ” |
| 3 | Model already saved this run → skip **and reset counter** | — | claude-code `hasMemoryWritesSince` |
| 4 | Too short | `< 200` chars or `< 2` turns | jcode `MIN_TURNS_FOR_EXTRACTION` |
| 5 | Topic change → extract now | similarity `< 0.12` | jcode `TOPIC_CHANGE_THRESHOLD` |
| 6 | Interval | `memory.extractEveryNRuns`, default `8` | jcode `PERIODIC_EXTRACTION_INTERVAL = 12` |

**Throttling loses nothing.** `buildTranscript()` rebuilds from the session's
*whole history*, not the current run, so a skipped run is still covered by the
next extraction rather than dropped.

**Topic change is free.** `lexicalSimilarity()` (`graph/index.ts:57`) and the
`0.12` threshold are already computed every turn for the retrieval stash; the
policy reuses the same function and constant so the two can never disagree.
Caveat: it does **not** strip stopwords — two prompts sharing only "and" score
`0.125` and stay above the threshold. This biases toward fewer extractions, which
is the right side for cost.

Measured over a simulated 20-run session: **20 provider calls → 3.**

### 3.4 Settings

```json
// .freecode/settings.json (project) beats ~/.freecode/settings.json (user)
{ "memory": { "autoExtract": true, "extractEveryNRuns": 8 } }
```

Scope order matches `permission/settings.ts`. **An unparseable settings file
falls through to defaults rather than disabling memory** — failing closed there
would silently kill the feature.

---

## 4. The read path

### 4.1 Every turn

`agent/loop.ts` → `MemoryGraphService.prepareMemories(sessionId, lastUserText)`
→ `renderRetrievedMemories()` → a `# Relevant memories` system block.

**One-turn-behind (spec D5).** A warm turn returns the *previous* turn's set
instantly and refreshes in the background; the loop never blocks. A cold turn
(session's first message, or right after a topic change cleared the set) waits
`COLD_BUDGET_MS = 60` for the fresh result, then falls back to background.

**Per session, not per project.** The graph and vectors are shared per project,
but the surfaced set is keyed by `sessionId` so two sessions never clobber each
other. LRU-bounded at `MAX_SESSIONS = 64`.

**Inner-turn caching.** Within one user request the loop may iterate many times,
but the user text doesn't change, so `lastMemoryQueryText` skips the round trip.

### 4.2 Retrieval itself

```
seed:    embed(query) → cosineTopK(K_INITIAL=10, threshold 0.4)
         └─ embedder unavailable? → findRelevantMemories() keyword scorer
cascade: BFS from seeds, maxDepth 2, score × edge.weight × DECAY(0.7) per hop
result:  top 8 entries
```

Edge weights (`graph-types.ts:30`):

| Edge | Weight | Built from |
| ---- | ------ | ---------- |
| `Supersedes` | 0.9 | `supersedes:` frontmatter |
| `HasTag` | 0.8 | `tags:` frontmatter |
| `RelatesTo` | 0.7 | `[[wikilinks]]` in the body |
| `InCluster` | 0.6 | k-means over embeddings |
| `Contradicts` | — | **excluded from cascade** — a negative signal shouldn't boost a neighbour |

### 4.3 Embeddings

- Model `all-MiniLM-L6-v2` via `fastembed` (ONNX), **384-dim**, cached in
  `~/.freecode/models/`, lazy-loaded on first embed so cold starts stay fast.
- **Dims are read from the model at runtime**, never hard-coded — a different
  model changes them.
- Storage: one packed `embeddings.bin`, keyed by `sha256(name+description+content)`.
  Unchanged files are never re-embedded.
- All sidecar writes are **write-temp-then-rename**; a torn or version-mismatched
  sidecar triggers rebuild-from-files.
- Clustering is **deterministic**: fixed `SEED = 42`, `MIN_POINTS = 6`,
  `MAX_ITERS = 25`, so rebuilds don't reshuffle.

### 4.4 Graceful degradation

If `fastembed`/onnxruntime can't load, `available()` flips to `false`
permanently and retrieval falls back to the keyword scorer (`mem-query.ts`) plus
the tag/wikilink graph walk. **Memory never throws into the agent loop.** The
failure is at ONNX *run* time, not import time, so `embed()` must flip the flag
on error and `sync()` must swallow it.

---

## 5. Prompt injection — the cache discipline

Two distinct blocks, in two distinct places, for one reason.

| Block | Where | Cached? | Changes when |
| ----- | ----- | ------- | ------------ |
| `buildMemoryGuidanceBlock()` — how to use memory | static system prefix (`context/compiler.ts`) | ✅ | never |
| `renderRetrievedMemories()` — the actual memories | session block, per turn | ❌ | every turn |

**`MEMORY.md` is deliberately never injected.** claude-code loads it every turn
and consequently caps it (`MAX_ENTRYPOINT_LINES = 200`,
`MAX_ENTRYPOINT_BYTES = 25_000`). Injecting it here would make the *cached
prefix* depend on the store, so every save would rewrite the prefix and bust the
whole session's prompt cache. Semantic retrieval already surfaces what's
relevant; `memory(action: "list")` answers what exists, on demand.

Net: a user with 0 memories and a user with 500 pay the same ~150 cached tokens.

There's a test that locks this (`mem-prompt.test.ts`): the guidance block must be
byte-identical regardless of store contents.

---

## 6. Security: secrets

`containsSecret()` (`graph/secret-filter.ts`) matches private-key headers,
`sk-ant-*`, `sk-*`, `AKIA*`/`ASIA*`, `ghp_*`, `github_pat_*`, `xox[baprs]-*`,
`AIza*`, `glpat-*`, and `key=value` assignments of secret-looking names.

It is enforced at **two** points, and the second one was a real hole:

1. **Before embedding** (`graph/index.ts:152, 211`) — original behaviour.
2. **Before writing**, in both the tool and the extractor — **added with the
   write path.** Previously a secret-bearing memory was never vectorized but
   *was* still written to disk in plaintext and still reachable through the
   keyword fallback.

Vectors never leave the machine. There is no network call anywhere in retrieval.

---

## 7. Surfaces

**Tool:** `memory` — registered in `tools/index.ts`, `TOOL_PERMISSIONS`
(`file.write`), `DISPLAY_NAMES`. Deliberately **not** in `READONLY_TOOLS`, so it
is blocked in `plan`/`review`/`explore` like every other tool that writes.

**What the user sees.** Two different paths, deliberately:

| The model saves it | Turn-end extraction saves it |
| --- | --- |
| Renders as a normal tool call (`● Memory — Saved memory feedback/prefers-tables.`) | Renders as a system notice: *"Remembered 2 things for next time: …"* |
| Magenta in the TS TUI, `󰍛` in the Rust TUI | Names each memory, and points at `/graph` and the off switch |

The notice travels on the **bus**, not the turn stream — extraction is
fire-and-forget and runs *after* the turn's `done`, so the stream is closed by
then. The bus speaker wire (`server.ts:1080`) is subscribed at startup and
writes to stdout regardless of whether a stream is open, so out-of-band notices
arrive fine. Wire event: `memory.saved` (bus) → `memory_saved` (`StreamEvent`).

Nothing is ever recorded about the user silently: this is the same rule
claude-code follows with `createMemorySavedMessage` (`utils/messages.ts:4460`),
emitted from both its extractor and its consolidation job.

**IPC:** `memory.list` · `memory.get` · `memory.save` · `memory.delete` ·
`memory.query` (routes through the graph service) · `memory.buildPrompt` ·
`memory.graph.rebuild` · `memory.graph.stats` · `graph.explore`

**CLI:** `freecode memory graph stats` · `graph rebuild` · `ui-install` ·
`ui-uninstall`

**`/graph`** — the optional explorer addon. Downloaded separately
(`~/.freecode/addons/graph-ui/`), never baked into the binary, checked at request
time so no restart is needed. Serves `/api/graph` (node-link dump) and
`/api/search?q=` (the real retrieval pipeline, with the walked path and per-hop
decayed scores). Read-only viewer; the API handlers work whether or not the addon
is installed.

---

## 8. Files

| File | Lines | Does |
| ---- | ----: | ---- |
| `memory/mem-types.ts` | 124 | `MemoryEntry`, frontmatter parse/serialize |
| `memory/mem-store.ts` | 268 | Files, `MEMORY.md` index, change events |
| `memory/mem-query.ts` | 80 | Keyword scorer (the fallback) |
| `memory/mem-prompt.ts` | 163 | Guidance block + retrieved-memories block |
| `memory/extract.ts` | 161 | Turn-end mining |
| `memory/extract-policy.ts` | 187 | The four gates + settings |
| `memory/graph/embedder.ts` | 70 | Lazy ONNX singleton |
| `memory/graph/vector-store.ts` | 212 | Packed f32, `cosineTopK`, hash cache |
| `memory/graph/graph-store.ts` | 116 | Adjacency, `graph.json` |
| `memory/graph/builder.ts` | 106 | Files → nodes/edges |
| `memory/graph/cascade.ts` | 89 | BFS with decay |
| `memory/graph/clusters.ts` | 152 | Deterministic k-means |
| `memory/graph/secret-filter.ts` | 26 | Credential patterns |
| `memory/graph/index.ts` | 506 | `MemoryGraphService` facade |
| `tools/memory.ts` | 251 | The tool |
| **Total** | **2,511** | plus `graph-explorer/` for `/graph` |

`graph/index.ts` is the intentional exception to the ~150-line rule; `mem-store.ts`
and `tools/memory.ts` are over it too and would decompose cleanly if they grow.

---

## 9. Debugging

| Symptom | Check |
| ------- | ----- |
| No memories retrieved | `freecode memory graph stats` — `nodes: 0` means the store is empty, not that retrieval is broken |
| `embedder: false` | `fastembed`/onnxruntime failed to load → keyword fallback. Expected in some binary builds |
| Retrieval feels stale | Sidecar out of sync → `freecode memory graph rebuild`, or delete `.graph/` |
| Memories never saved automatically | Check the gates: `FREECODE_DISABLE_MEMORY_EXTRACTION`, `memory.autoExtract`, and whether the session reached 8 runs or a topic change |
| Extraction seems to never fire | Debug log line `[MemoryExtract] skipped: <reason>` names the exact gate |
| Wrong project's memories | §2 — the key is the *basename*; two projects with the same folder name collide |
| Cache hit rate dropped after a save | Should be impossible; the guidance block is constant. If it happens, something injected store-dependent text into the static prefix |

---

## 10. Known gaps

1. **No session-end flush.** The throttle means a session ending before 8 runs
   or a topic change **never extracts at all** — a one-shot session where the
   user states a preference and leaves loses it unless the model saved it with
   the tool. The obvious hook doesn't work: `disposeSessionMemory` has exactly
   one call site (`server.ts:964`, `session.delete`), so it never fires on
   `session.switch`, `session.archive`, `session.stop`, or process exit. Needs a
   genuine session-end signal. **This is the most valuable next thing to build.**
2. **Project key collisions.** `basename` means `~/work/api` and `~/side/api`
   share memories (§2).
3. **No consolidation.** claude-code has `autoDream`; jcode has ambient mode. We
   have neither, which is why the 3-save cap exists.
4. **No automated test for save → retrieve.** Verified by hand only: a scratch
   run gives `{vectors:1, dims:384, nodes:1, embedder:true}` and retrieves the
   saved memory from a paraphrased query.
5. **Tuning values are guesses.** `MAX_SAVES_PER_RUN = 3`, interval `8`,
   `MIN_TRANSCRIPT_CHARS = 200`. Chosen to bound cost, not derived from data.
6. **`memory` blocked in plan mode** (D7) — a preference stated while planning
   isn't captured. Fail-closed was the deliberate choice.

---

## 11. Comparison to prior art

| | freecode | claude-code | jcode |
| --- | --- | --- | --- |
| Model can save | ✅ `memory` tool | ✅ ordinary Write tool | ✅ memory-agent tools |
| Told it has memory | ✅ cached block | ✅ every turn + MEMORY.md | ✅ |
| Auto-extraction | ✅ throttled | ✅ every completed loop | ✅ topic + periodic + session end |
| Extraction cost | fresh call, gated | forked agent, shares prompt cache | local judge |
| Session-end flush | ❌ | ✅ | ✅ |
| Consolidation | ❌ | ✅ `autoDream` | ✅ ambient |
| Secret filter on write | ✅ | — | ✅ |
| Retrieval | vectors + graph cascade | LLM picks ≤5 from a manifest | vectors + graph + LLM rerank |
| Kill switch | ✅ env + settings | ✅ env + settings + flags | ✅ |

FreeCode has the strongest retrieval of the three and the youngest write side.
The two things worth stealing next are both about *capture completeness*, not
retrieval: a session-end flush (both have it) and consolidation (both have it).
