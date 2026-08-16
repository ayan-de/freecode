# Mem0 (OSS) vs FreeCode — Comparative Study

> Side-by-side audit of FreeCode's memory layer against Mem0's open-source
> Python SDK (`mem0ai` v2.0.18, this repo). Each section: **Mem0 mechanic**
> with code references, **FreeCode equivalent** with code references, then
> **gap direction** and **how to close**.
>
> **Scope.** OSS only. Mem0's hosted platform (`app.mem0.ai`) and self-hosted
> server (Docker image, not in this repo) are out of scope — they ship features
> that aren't in the `mem0ai` PyPI package (autoDream, hosted graph DB,
> consolidation, decay at scale).
>
> **Audit date.** 2026-08-16. Mem0 OSS commit: HEAD of `main`. FreeCode
> HEAD of `main`.

| | FreeCode wins | Even | Mem0 wins |
|---|---|---|---|
| Async write-path | ✓ | | |
| Privacy / secret handling | ✓ | | |
| Graph cascade / retrieval | ✓ | | |
| Markdown source-of-truth | ✓ | | |
| D3 graph explorer | ✓ | | |
| Cluster edges | ✓ | | |
| Wikilink edges | ✓ | | |
| Session lifecycle | ✓ | | |
| Remote sync | ✓ | | |
| Storage substrate portability | ✓ (different bets) | | |
| Provider matrix | | ✓ (deliberately narrow) | |
| Vision parsing | | | n/a (out of scope) |
| **Dedup-aware extraction** | | | ✓ |
| **Two-pass extractor (extract → update)** | | | ✓ |
| **Inline UPDATE/DELETE via LLM** | | | ✓ |
| **Audit / history table** | | | ✓ |
| **`expiration_date` / temporal** | | | ✓ |
| **Identity fields (user/agent/run/actor)** | | | ✓ |
| **BM25 hybrid scoring** | | | ✓ (marginal for FreeCode) |
| **Lemmatization** | | | ✓ |
| **Entity-boost at retrieval** | | | ✓ (overlaps with wikilinks) |
| Telemetry | n/a (different product) | | |

---

## 1. Storage substrate

### Mem0 (this repo)

Vector store as primary storage. Provider-pluggable via `mem0/configs.py`
vector-store schemas: pgvector, Chroma, Qdrant, FAISS, Pinecone, Milvus,
MongoDB Atlas, Elasticsearch, Redis, Weaviate, Databricks, Baidu, Cassandra,
Turbopuffer — and the rest. SQLite side-table for history (`mem0/memory/storage.py`)
and per-project messages. `~/.mem0/config.json` holds user identity + telemetry
opt-in.

The vector payload is **opaque JSON** — Mem0 never reads it back, only the
embedder does for similarity search.

### FreeCode

Markdown files as source of truth (`apps/core/src/memory/mem-store.ts:112-179`),
plus a derived sidecar (`.graph/`) holding graph + embeddings
(`apps/core/src/memory/graph/index.ts:24`).

The markdown is **the canonical store**. Delete `.graph/` and it rebuilds.

### Verdict

Different bets. Neither is wrong.

| | Mem0 | FreeCode |
|---|---|---|
| Source of truth | Vector payload (opaque) | Markdown (git-friendly) |
| Rebuildable | No | Yes (delete `.graph/`) |
| Edit by hand | Painful | `cat > foo.md` |
| Diff in PRs | Hard | Trivial |
| Portable | Tied to provider | Plain files |
| Build cost per write | LLM embed + DB write | File write + async rebuild |

**Borrow from Mem0?** No.
**Borrow from FreeCode?** Yes — but the direction doesn't apply.

---

## 2. Extraction — the biggest difference

This is where the gap is largest.

### Mem0 — `add()` pipeline

```
add(messages, user_id="alice")
  ↓
build_retrieval_messages()  # 50+ lines of system prompt
  ↓
llm.generate_response()      # blocking, ~1–3s
  ↓
parse + normalize_facts()    # list[str]
  ↓
For each new fact:
    query existing memories with semantic similarity
    pass top-k existing memories to LLM as JSON
  ↓
Second LLM call with ADDITIVE_EXTRACTION_PROMPT (476 lines)
  Output: [{event: "ADD"|"UPDATE"|"DELETE"|"NONE", text, old_memory,
            linked_memory_ids, …}]
  ↓
For each ADD/UPDATE/DELETE:
    embed, persist, history.write, entity link
```

Critical references:

- `mem0/memory/main.py:879` — `_add_to_vector_store` orchestration
- `mem0/memory/prompts.py:63` — `USER_MEMORY_EXTRACTION_PROMPT` (50+ lines)
- `mem0/memory/prompts.py:124` — `AGENT_MEMORY_EXTRACTION_PROMPT`
- `mem0/memory/prompts.py:468-944` — `ADDITIVE_EXTRACTION_PROMPT` (476 lines,
  the dedup/update prompt)
- `mem0/memory/prompts.py:176-324` — `DEFAULT_UPDATE_MEMORY_PROMPT` (149 lines)

The dedup instructions in `ADDITIVE_EXTRACTION_PROMPT`
(`prompts.py:511`) are explicit:

> "If new information in New Messages is semantically equivalent to an Existing
> Memory with no meaningful new context, skip it."

The `UPDATE` / `DELETE` events return an explicit `old_memory` text the LLM
wants to act against, plus `linked_memory_ids` for graph-like linkage.

### FreeCode — `extractMemories()`

```
extractMemories({ transcript, projectPath, provider })
  ↓
oneShot() — single LLM call with SYSTEM prompt (~17 lines) + transcript
  ↓
parseProposals() — regex fences, JSON parse, validate
  ↓
for each proposal: load existing by (name, type), skip if identical, else
                   store.save()
```

`apps/core/src/memory/extract.ts:22-37` — the **whole system prompt**:

```text
You extract durable memories from a coding session.
Return ONLY a JSON array, no prose. Each element:
{"type": "user|feedback|project|reference", "name": "kebab-case-slug", ...}
Save only what will still be true next week: ...
Never save: anything derivable from the code, git history, project docs; how a
bug was fixed; task details that stop mattering when this task ends; credentials.
Most turns contain nothing worth saving. Returning [] is the common, correct
answer — prefer it over a weak memory. Never return more than 3.
```

### What Mem0 has that FreeCode does not

1. **Prompt-engineered extractor with rich context.** Mem0's user prompt
   (`prompts.py:63`) is 50+ lines defining role, scope, what to extract,
   what NOT to extract, what casual topics count, examples per speaker role.
   FreeCode's prompt is 17 lines.

2. **Existing-memory visibility to the extractor.** Mem0's two-pass design
   passes top-k existing memories to the second LLM call so it can emit
   `UPDATE` / `DELETE` against them. FreeCode's extractor
   (`apps/core/src/memory/extract.ts:130`) loads existing memories by `name`
   to dedup *identical text* — but never tells the LLM they exist, so
   "I switched from Go to Rust" tomorrow will propose a brand-new
   `user_language` memory.

3. **Structured `UPDATE` / `DELETE` events.** Mem0's prompt explicitly returns
   `event: "UPDATE" | "DELETE"` plus the `old_memory` text. FreeCode's
   `supersedes` field (`apps/core/src/memory/mem-types.ts:23`) is the *manual*
   form — author has to know to set it.

4. **`linked_memory_ids` linking.** Mem0's LLM emits a list of UUIDs the new
   fact relates to. FreeCode has `[[wikilink]]` in body text — better in some
   ways (human-readable, navigable in the UI), but only triggers when the LLM
   notices to write the wikilink.

5. **Two-pass split.** Pass 1 (extract) and Pass 2 (dedup/update) are
   focused. FreeCode tries to do everything in one prompt and gets neither
   dedup nor update right.

### How to close

In `apps/core/src/memory/extract.ts`, replace the single 17-line prompt with
two passes:

- **Pass 1** — current prompt, expanded to ~50 lines matching Mem0's
  `USER_MEMORY_EXTRACTION_PROMPT` detail: "What to extract", "Do not extract",
  "Casual topics are extractable", worked examples per memory type.
- **Pass 2** — only if Pass 1 returned candidates. Fetch top-k existing
  memories from `MemoryGraphService.retrieve(transcript, k=10)` (already
  exists). Pass them to a second LLM call with a port of Mem0's
  `DEFAULT_UPDATE_MEMORY_PROMPT` so the LLM emits
  `ADD` / `UPDATE` / `DELETE` / `NONE` per candidate.

Cost: ~50 ms per Pass 2 on top of the existing one-shot. Win: dedup,
implicit contradiction handling, link graph.

---

## 3. Retrieval

Both systems retrieve well. They do it differently.

### Mem0 — `_search_vector_store`

`mem0/memory/main.py:1628`:

1. `lemmatize_for_bm25(query)` + `extract_entities(query)` (spaCy NER)
2. Embed query → semantic search → `internal_limit = max(limit*4, 60)`
   over-fetch
3. `keyword_search(query_lemmatized)` if store supports BM25
4. `bm25_scores` per result (normalize_bm25)
5. `entity_boosts` from entity store
6. Build candidate set from semantic results, drop expired
7. `score_and_rank()` — fused scoring
8. Format + return MemoryItem list

Scoring formula in `mem0/utils/scoring.py`:

```
score = semantic_score + bm25_normalized + entity_boost_weight
```

### FreeCode — `MemoryGraphService.retrieve`

`apps/core/src/memory/graph/index.ts`:

1. Embed last user message (or keyword fallback if embedder unavailable)
2. Vector top-k of seeds (`K_INITIAL=10`, threshold 0.4)
3. BFS from seeds through graph edges (depth ≤ 2, decay 0.7)
4. Edge weights: `Supersedes 0.9 > HasTag 0.8 > RelatesTo w > InCluster 0.6`
5. `Contradicts` excluded from cascade
6. Trim to top-k (e.g. 8)
7. Per-session cache (LRU 64) with one-turn-behind async refresh

### Comparison

| | Mem0 | FreeCode |
|---|---|---|
| Semantic search | ✓ | ✓ |
| BM25 hybrid | ✓ (`scoring.py`) | ✗ (keyword fallback is hand-tuned) |
| Lemmatization | ✓ (`utils/lemmatization.py`) | ✗ |
| Entity boost | ✓ (spaCy NER + entity store) | Implicit via tags |
| Graph cascade | ✗ | ✓ (BFS over wikilink/tag/supersede/cluster) |
| Cluster edges | ✗ | ✓ (k-means, `clusters.ts`) |
| Wikilink edges | ✗ (only `linked_memory_ids`) | ✓ |
| `expiration_date` filter | ✓ | ✗ |
| `score_details` for explain | ✓ | ✗ |
| Async non-blocking | ✗ | ✓ (one-turn-behind) |
| Secret filter at retrieval | ✗ | ✓ |

### How to close

If you want to adopt from Mem0:

1. **Lemmatize queries** — ~20 lines, port from `utils/lemmatization.py`.
   Simple win for keyword recall.
2. **Add `expiration_date`** to `MemoryEntry` (`mem-types.ts:9-23`) and an
   optional filter in `MemoryGraphService.retrieve`. ~25 lines.
3. **Add `score_details` for explain mode** — useful for the graph
   explorer's "why was this surfaced?" hover.

Do **not** adopt BM25 hybrid from Mem0 unless you find a real recall
regression. Cascade already covers most of what BM25 buys on a memory
store of <1000 entries.

---

## 4. Conflict resolution

### Mem0

Two paths:

- **Inline at extraction time** via `DEFAULT_UPDATE_MEMORY_PROMPT` — LLM
  emits `UPDATE` / `DELETE` for existing memories whose `old_memory` text
  doesn't match. (`prompts.py:176-324`.)
- **Manual** via `m.update(memory_id, text=...)` and `m.delete(memory_id)`.

Both flow through `_update_memory` (`main.py:2032`) and `_delete_memory`
(`main.py:2094`), each writing to the history table.

### FreeCode

Two paths:

- **Inline via `supersedes`** — author writes `supersedes: [old-name]` in
  frontmatter; the new memory replaces the old in cascade.
- **Manual** via the memory tool's `delete` action.
- **`Contradicts` edge** — graph-level flag, excluded from cascade scoring.
  But **no path emits it today**, so it's orphaned.

### Gap

| | Mem0 | FreeCode |
|---|---|---|
| Implicit contradiction | Yes (`UPDATE`/`DELETE` from LLM) | No (extractor blind to existing) |
| Explicit supersede | Manual `update()` | `supersedes` frontmatter + tool |
| Audit trail | SQLite history table | None |
| Graph-level contradict | n/a | `Contradicts` edge (orphaned) |

### How to close

Fix is the dedup-aware extraction from section 2. Once Pass 2 emits
`UPDATE` / `DELETE` events, route them through new
`MemoryStore.update()` and `MemoryStore.delete()` methods, and add the
SQLite history table (section 5).

---

## 5. History / audit trail

### Mem0 — `SQLiteManager`

`mem0/memory/storage.py:11-348`. ~340 lines. Tables:

- `_create_history_table` —
  `id, memory_id, old_memory, new_memory, event, created_at, updated_at, is_deleted, actor_id, role`
- `_create_messages_table` — same shape for last-N session messages
- `add_history(memory_id, old_memory, new_memory, event, ...)`
- `batch_add_history(records)` — one transaction
- `get_history(memory_id)` — full timeline

Migrations: `_migrate_history_table` (lines 20-100) — the code is
battle-tested across schema evolutions.

### FreeCode

Nothing. `mem-store.ts:115` overwrites in place. You can recover the latest
version of a memory from git history if the project is git-tracked, but
**the index of *which* fact got replaced by *which* other fact at *what
time* is gone**.

### How to close

Three options, ordered by complexity:

1. **Append-only JSONL sidecar** —
   `~/.freecode/projects/<slug>/memory/.history.jsonl` with
   `{"ts", "action", "type", "name", "old", "new"}`. No new dependency.
   ~50 lines.

2. **SQLite table in existing `freecode.db`** — your `state/freecode.db`
   already exists. Add a `memory_history` table mirroring Mem0's schema.
   Atomic writes, indexed lookups, joins with `threads` / `turns` for
   "what changed in this session?" views.

3. **Git-tracked log file** — single append-only log in project root.
   Breaks the per-project separation rule.

**Recommend option 2.** You already pay the SQLite cost. Schema:

```sql
CREATE TABLE memory_history (
  id TEXT PRIMARY KEY,
  memory_id TEXT,
  old_memory TEXT,
  new_memory TEXT,
  event TEXT,        -- ADD | UPDATE | DELETE
  created_at DATETIME,
  actor_id TEXT,
  role TEXT
);
```

Once `extractMemories()` Pass 2 emits `ADD` / `UPDATE` / `DELETE` events,
write one row per event.

---

## 6. Multi-tenancy

### Mem0 — 4 identity fields

`mem0/memory/main.py:135`:

```python
ENTITY_PARAMS = frozenset({"user_id", "agent_id", "run_id"})
_IDENTITY_KEYS = ENTITY_PARAMS | {"actor_id"}
```

Every operation takes `user_id` / `agent_id` / `run_id` as scope. `actor_id`
is the speaker (user-vs-assistant in multi-agent setups). Identity keys in
caller-supplied metadata are dropped with a warning (`main.py:143-162`).

`_build_session_scope` (`main.py:412`) builds the canonical
`user_id|agent_id|run_id|actor_id` string used for storage.

### FreeCode — 1 implicit dimension

`apps/core/src/memory/mem-store.ts:31-35` keys everything off
`sanitizeProjectName(projectPath)` = `path.basename(projectPath)` with
non-`[a-zA-Z0-9_-]` replaced by `_`. **No `user_id`, no `agent_id`, no
`run_id`, no `actor_id`.** Two projects named the same thing collide. Two
users on the same project can't have separate memory spaces.

### Gap

Real gap, but not for FreeCode's current use case (single-developer CLI).
Becomes a gap if you ever want shared-team memory or multi-user-per-project.

### How to close

Add `user_id?: string` to `MemoryEntry` (`mem-types.ts:9-23`). At write
time, default to `process.env.USER`. At read time, filter by `user_id`
unless caller explicitly opts out. ~15 lines + a migration to backfill
existing entries with `user_id = "<unknown>"`.

You do not need `agent_id` / `run_id` / `actor_id` unless you build
multi-agent features.

---

## 7. Entity graph

### Mem0 — separate entity store

`mem0/memory/main.py:_entity_store` is a separate vector collection
holding `(entity_text, entity_type, source, start, end, confidence,
linked_memory_ids)` per extracted entity. At extract time
(`_link_entities_for_memory`, `main.py:707`), every new memory gets
linked to entities extracted from its body. At search time
(`_compute_entity_boosts`, `main.py:1733`), query entities boost their
linked memories.

Entities extracted by **spaCy NER** (`utils/entity_extraction.py`), not
LLM — proper nouns, quoted text, noun compounds. Lightweight, deterministic,
free.

### FreeCode — tag + wikilink + cluster edges

`apps/core/src/memory/graph/graph-types.ts`:

| Edge | Source | Example |
|---|---|---|
| `HasTag` | frontmatter `tags` | `[graph, semantic]` |
| `RelatesTo` | `[[wikilink]]` in body OR embedding sim | |
| `Supersedes` | frontmatter `supersedes` | |
| `Contradicts` | (none today — orphaned) | |
| `InCluster` | k-means over embeddings (`clusters.ts`) | |

### Comparison

| | Mem0 | FreeCode |
|---|---|---|
| Entity extraction | Automatic (spaCy NER) | Manual (wikilinks) or cluster |
| Author control | No (LLM/spaCy emits) | Yes (`[[name]]`) |
| Cluster edges | No | Yes (`InCluster`) |
| Cascade scoring | No — entity-boost only | Yes — full BFS |
| Graph visualization | No | Yes (D3) |

**Neither is uniformly better.** Mem0's automatic entities > FreeCode's
manual wikilinks for serendipitous recall. FreeCode's cascade > Mem0's
flat ranking for "and what else relates to this?".

### How to close

If you want automatic entity extraction in FreeCode:

1. Add `entity-extractor.ts` — port Mem0's `extract_entities` approach
   but use a lightweight option (compromise list of capitalized-noun-phrases;
   you don't need spaCy for memory content which is well-structured
   markdown). ~80 lines.
2. At extract time, run entity extraction on each new memory and add
   `MentionsEntity` from the memory to each entity. Store entities in a
   separate sidecar (e.g. `.graph/entities.json`).
3. At retrieval time, do **not** use entity-boost as a separate score.
   Instead, surface entity edges into the cascade — a memory 2 hops away
   via a shared entity is already reachable, and cascade's decay-0.7
   weights it correctly.

Alternative: **don't adopt this.** Your wikilink + cluster system is
genuinely good, and adopting automatic entity extraction will surface
noisy "User mentioned Go" entities that compete with real wikilinks.

---

## 8. Async / write-path latency

### Mem0

`add()` is **synchronous and blocking**. From `main.py:_add_to_vector_store`
(lines 879-1207), the call sequence inside one `add()`:

1. Build retrieval messages
2. Call LLM (blocking, ~1-3s)
3. Parse response
4. Batch embed (`embedding_model.embed_batch`, blocking)
5. Hash dedup
6. Batch insert into vector store (blocking)
7. Entity extraction + linking
8. History table write

`AsyncMemory` class (`main.py:2167+`) provides `async def add()` with the
same flow but using async APIs. The class is 1,685 lines.

No "fire-and-forget" pattern. Every `add()` is a complete wait.

### FreeCode

`mem-store.ts:save()` (`mem-store.ts:112-118`) writes the file synchronously
then emits `MemoryChange` to listeners. The graph service
(`graph/index.ts:116-120`) registers as a listener and calls
`void this.onChange(change)` — **fire-and-forget, never awaited** (spec D2).
`onChange` (`graph/index.ts:141+`) is `async` and runs in the single-flight
queue.

Same for retrieval: `MemoryGraphService.prepareMemories` runs in the
background; the previous turn's results are injected into the current turn
(one-turn-behind, spec D5).

### Verdict

**FreeCode wins this category decisively.** Mem0's `add()` blocks the
calling turn on LLM + embed + DB. FreeCode's `add()` returns in microseconds;
graph maintenance happens behind the user.

`docs/superpowers/specs/2026-08-09-memory-write-path.md` is your explicit
design intent and it's right.

---

## 9. Privacy / secret handling

### Mem0

No built-in secret filter. Storage is opaque JSON; if the LLM extracts
"API key is sk-abc123", it lands in the vector store. Retrieval returns it;
prompt injection surfaces it in future turns. Telemetry redacts
`_SENSITIVE_FIELDS_EXACT` (`main.py:104-123`) but only for **telemetry**,
not for storage or retrieval.

### FreeCode

Two layers:

1. **Write-time** — `apps/core/src/memory/tools/memory.ts:190-199` refuses
   to save if `containsSecret(description + content)` is true.
2. **Embed-time** — `apps/core/src/memory/graph/index.ts:155-159` removes
   the vector if the content is detected as a secret after the fact.

Both call `apps/core/src/memory/graph/secret-filter.ts:containsSecret()`
which runs regex patterns for API keys, JWTs, PEM blocks, AWS keys, etc.

### Verdict

**FreeCode wins this category decisively.** Mem0 has no secret filter.

---

## 10. Session-end flush — FreeCode's #1 documented gap

### Mem0

Every `add()` is itself a save. There is no "session-end flush" because
there is no separate session-end concept — `add()` is the only persistence
path.

### FreeCode

`extractMemories` is called per-turn (`extract-policy.ts` decides when),
but the *unsaved* facts from the user's running session are not flushed
on:

- `session.switch`
- `session.archive`
- `session.stop` (Ctrl+C)
- Process exit

Per `MEMORY_SYSTEM.md` §10.1 and prior internal discussion, this is the
biggest gap.

### Gap

This is purely a FreeCode-side gap. Mem0 has nothing to teach here
(its model is different).

### How to close

Per prior decisions: wire `disposeSessionMemory` to session
switch / archive / stop exit points. Already known.

---

## 11. Temporal / decay features

### Mem0

- **`expiration_date`** per memory. Filtered out at search via
  `show_expired=False` default.
- **Custom instructions + `feedback_str` + `includes` / `excludes`**
  passed to the extractor.
- **Decay** — concept exists (`notices.py:detect_decay_usage_from_delete`),
  but actual decay behavior is hosted-only.
- **Top-k size threshold telemetry** — `notices.py:detect_scale_threshold_from_top_k`
  warns when your store is past the "you should use a hosted backend"
  threshold.

### FreeCode

No temporal at all. `createdAt` / `updatedAt` exist on `MemoryEntry`
but are not used in retrieval. Frontmatter does not support
`expiration_date`.

### Gap

Real gap for project-type memories that are time-bounded
("Sprint 47 deadline is March 15", "We're mid-migration to X until April").

### How to close

Add `expiration_date?: string` to `MemoryEntry`. At retrieval, skip
memories whose `expiration_date < now`. ~25 lines including the schema
migration.

---

## 12. Telemetry, diagnostics

### Mem0

`mem0/memory/telemetry.py` — anonymous usage tracking via PostHog.
`capture_event()` called on `add`, `search`, `update`, `delete`, `reset`,
`init`. The `notices.py` module (1,582 lines) prints in-CLI warnings for
first-run, scale thresholds, slow queries, decay usage, temporal usage.

### FreeCode

No telemetry. `utils/logger.ts` for internal debug logs.

### Verdict

Different product contexts. FreeCode is a CLI for individual developers;
telemetry would be inappropriate. Mem0 is a SaaS with an OSS frontend that
funnels users toward hosted. **Not a real gap** — different scope.

---

## 13. Misc small things

### Mem0 has, FreeCode does not

- **Vision message parsing** (`utils.py:parse_vision_messages`) — handles
  image content, descriptions via LLM. FreeCode never sees images.
- **`MIGRATION_002` / `_migrate_history_table`** — production-grade SQLite
  migrations. FreeCode has no migrations (files are the truth).
- **`mem0 reset()`** — clears vector store and history. FreeCode equivalent:
  delete `.graph/` directory.
- **`mem0 chat(query)`** — convenience method, runs `search()` then formats
  the result with `MEMORY_ANSWER_PROMPT` for Q&A over memory. FreeCode's
  memory tool does the same job.
- **Wide provider matrix** — 16 LLM providers, 30+ vector stores. FreeCode
  has 1 of each, deliberately.
- **Structured output** — `pydantic` schemas for `MemoryItem`, `MemoryConfig`.
  FreeCode is plain TS interfaces.

### FreeCode has, Mem0 does not

- **Human-readable source of truth** — markdown files.
- **`MEMORY.md` index** — navigable from any markdown editor.
- **`[[wikilink]]` in body** — navigable in the graph explorer.
- **Tags in frontmatter** — author-declared topical cluster.
- **Cluster edges from k-means** — surfaced via `clusters.ts`.
- **D3 graph explorer** — `apps/core/src/graph-explorer/` ships a visual UI.
- **Async one-turn-behind retrieval** — the only one of the two systems
  with a non-blocking retrieval path.
- **Secret filter** at write time + embed time.
- **`onMemoryChange` listener bus** — keeps the graph service decoupled
  from `MemoryStore`.
- **Session lifecycle** (`session.start / resume / fork / archive / delete`)
  — Mem0 has none; memories are persisted independently of session context.
- **Remote sync (URL-based)** — `store/remote.ts`. Mem0 has nothing comparable.

---

## Summary of gaps — ranked

Sorted by "implement cost vs value to FreeCode":

| Gap | Mem0 mechanic | FreeCode gap | Worth borrowing? | Cost |
|---|---|---|---|---|
| **Dedup-aware extraction** | Pass existing memories to LLM, emit ADD/UPDATE/DELETE | `extract.ts` blind to existing | **Yes — highest value** | ~150 LOC + 2nd LLM call |
| **History table** | SQLite history with old/new/event | None | **Yes** | ~50 LOC + SQLite table |
| **Async session-end flush** | n/a (every add is a save) | Memories lost on session end | n/a (own gap) | already known |
| **Lemmatization for keyword fallback** | `utils/lemmatization.py` | None — keyword fallback is raw tokenize | Marginal | ~30 LOC |
| **`expiration_date`** | Per-memory, filter at search | None | Yes for project/feedback types | ~25 LOC |
| **BM25 hybrid scoring** | `utils/scoring.py` | None — pure cascade | No unless recall regression | ~200 LOC |
| **Entity-boost at search** | spaCy NER + linked_memory_ids | None | No — wikilinks + clusters suffice | ~250 LOC |
| **Multi-tenancy** | user_id/agent_id/run_id/actor_id | project_path basename | Maybe later | ~100 LOC |
| **Vision parsing** | `parse_vision_messages` | None | No — out of scope | n/a |

**The single highest-value adoption is the two-pass dedup-aware extractor.**
It's the difference between "extractor that proposes facts" and "memory
manager that maintains a coherent store." Mem0 has the prompt engineering
battle-tested across thousands of users. Port `ADDITIVE_EXTRACTION_PROMPT`
directly; only translate Python-JSON-schema examples to TS.

---

## See also

- `MEMORY_SYSTEM.md` — FreeCode's complete implementation reference
- `MEMORY_KNOWLEDGE_GRAPH_EXPLAINER.md` — conceptual walkthrough of
  embeddings + cascade
- `specs/2026-07-26-memory-knowledge-graph.md` — read side spec
- `specs/2026-08-09-memory-write-path.md` — write side spec
- `specs/2026-08-04-memory-graph-explorer-design.md` — viewer spec
- Mem0 source (this repo): `mem0/memory/main.py`, `prompts.py`, `storage.py`