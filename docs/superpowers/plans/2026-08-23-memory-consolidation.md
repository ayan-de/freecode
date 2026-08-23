# Plan: Memory Consolidation & Episodic Recall

> **Date:** 2026-08-23
> **Spec:** `docs/superpowers/specs/2026-08-23-memory-consolidation.md`
> **Status:** Proposed
> **Scope (locked):** Retrieval quality (BM25 + rank fusion + a floor and a byte
> cap), a usage-attribution loop, session-end flush, episodes as a fifth memory
> type, and a daily merge/prune pass over a git-diffed memory directory. No new
> runtime dependencies. No LLM reranker. No read-path redesign (progressive
> disclosure stays out — spec §11.5).

Six phases, ordered so that measurement precedes the changes it judges and the
usage signal precedes the decisions that read it. Each phase leaves the loop
working and ships alone. Files target ~150 lines (project rule).

**The rule for this plan:** no phase that changes retrieval merges without a
Phase 0 before/after in its PR description. Every constant in this system is
currently a guess, and the point of Phase 0 is that they stop being guesses one
at a time.

---

## Phase 0 — The ruler (D14)

No product change. It only reports numbers about today's behaviour, and it is
what makes Phase 1 arguable.

1. `memory/bench/corpus/` — a committed synthetic fixture: ~40 memories across
   all four types (deliberately including three near-duplicate pairs and two
   superseded chains) and ~20 labelled queries. Each query carries
   `relevant: string[]` (ids) — and **five carry `relevant: []`**, the abstention
   cases. Plain JSON, hand-written, no generation script.
2. `memory/bench/pool.ts` — for each query, run `MemoryGraphService.retrieve()`
   against a temp store loaded from the corpus and record the ranked ids. Call
   the **production** service, not a reimplementation; that is the whole design
   constraint jcode's harness exists to enforce.
3. `memory/bench/metrics.ts` — recall@{5,10}, precision@5, MRR, nDCG@10, and
   **abstention accuracy** (fraction of `relevant: []` queries that returned
   nothing). Pure functions over `(ranked, relevant)`; no I/O.
4. `memory/bench/metrics.test.ts` — hand-computed expectations on a
   five-document fixture. The harness is the thing later phases are judged by,
   so it gets tested before it is trusted.
5. `memory/bench/run.ts` + a `bench:memory` package script — runs stages 2 and 3
   and prints a table; `--json` for diffing. Cache the query and pool stages to
   `.bench/` so re-running metrics does not re-embed.
6. Record model calls and tokens per config (zero for every config in this plan;
   the field exists so a future reranker is compared at equal cost, not declared
   better for spending more).

**Verify:** `pnpm bench:memory` prints a full table against today's retrieval.
Commit that table into the PR description as the baseline. Expect **abstention
accuracy near zero** — that is defect 3 showing up as a number, and it is the
single result that justifies Phase 1.

**Deferred to its own PR, not blocking:** the LongMemEval-S loader
(`memory/bench/longmemeval.ts`) — downloads to a path outside the repo, never
commits data, skips with a message when absent. It is the external corpus nobody
here authored; the synthetic fixture is what runs in CI.

---

## Phase 1 — Retrieval quality (D1, D2)

The only phase that saves tokens, and the one most likely to regress recall if
done blind. Ship with numbers.

### 1a — BM25 (D1.1)

1. `memory/bm25.ts` — build a term-frequency index over `MemoryStore.list()`
   (name, description, content as separate fields), and `score(query, id)` with
   `k1 = 1.2`, `b = 0.75`. Description keeps a field boost so today's +5/+1
   intent survives; exact-name match keeps its bonus. ~40 lines, no dependency.
2. `memory/mem-query.ts` — `score()` delegates to it. Keep `findRelevantMemories`'s
   signature; add a `withRanks` variant returning `{ id, rank }` for fusion.
3. Build the index inside the existing `sync()` pass in `graph/index.ts` so it is
   refreshed off the same entry list as the embeddings — one traversal, one
   staleness story.
4. `memory/bm25.test.ts` — IDF demotes a term in every document; length
   normalization stops a long memory outranking a precise short one on the same
   query (today's actual defect); empty and single-document corpora do not
   divide by zero.

**Verify:** `pnpm bench:memory` against the Phase 0 baseline. Expect precision@5
and MRR up. If recall@10 drops, stop — that is BM25 tuning, not a reason to
proceed.

### 1b — Rank fusion and the floor (D1.2, D1.3)

5. `graph/index.ts` `seed()` — stop choosing. Take `K_INITIAL` candidates from
   `cosineTopK(qvec, K_INITIAL, SEED_THRESHOLD)` **and** `K_INITIAL` from BM25,
   fuse with `rrf(d) = Σ 1/(RRF_K + rank_r(d))`, `RRF_K = 60`. Fused top-k seeds
   the cascade unchanged. `!embedder.available()` still yields lexical-only —
   now a good path rather than a tolerated one.
6. Apply the floor to the **fused** score. Delete the terminal
   `out.length > 0 ? out : fallback()` in `retrieve()` (`graph/index.ts:297`):
   an empty cascade over fused seeds is an answer.
7. `retrieveForExplorer()` — its `seedMode: "vector" | "keyword"` becomes
   `"fused" | "lexical_only"`; the explorer UI reads it (`graph-explorer/`).
8. `memory.query` (IPC) keeps the permissive path — an explicit search shows weak
   matches. Assert this in a test; it is the easiest thing to break by accident.
9. `memory/graph/fusion.test.ts` — a document found by both retrievers outranks
   one found by either; **fusion order is invariant to score scale** (multiply
   all cosines by 100 → same order). That invariance is why RRF was chosen over
   weighted-sum, so it is the property worth pinning.

**Verify:** abstention accuracy goes from ~0 to near 1.0 while recall@10 holds
within noise of the Phase 0 baseline. Both numbers in the PR. Sweep `RRF_K`
∈ {20, 60, 100} and the floor, and record the chosen values with their evidence —
spec §10.5 says these stop being guesses here.

### 1c — Score plumbing and the byte cap (D2)

10. Introduce `RetrievedMemory = { entry: MemoryEntry; score: number }` and thread
    it through `retrieve()` → `prepareMemories()` → the session stash →
    `renderRetrievedMemories()`. Today the score is computed and dropped
    (`graph/index.ts:288`); D2's degradation and Phase 2's attribution both need it.
11. `mem-prompt.ts` — `MAX_MEMORY_BLOCK_BYTES = 2048`. Emit in descending score;
    once the budget is spent, remaining entries degrade to `- name — description`;
    past that, drop.
12. `mem-prompt.test.ts` (extend) — a 10 KB memory renders under 2 KB;
    degradation follows score order; **the guidance block stays byte-identical
    regardless of store contents** (write-path D2 depends on this for cache
    stability — assert it explicitly).

**Verify:** with a 10 KB memory in the store, the rendered block is ≤ 2 KB and
the cached static prefix is unchanged. Bench metrics must not move — this is a
rendering change, and if recall shifts, the plumbing reordered something.

---

## Phase 2 — The usage loop (D12)

One prompt line, one parser, one sidecar file. Independently valuable: it is the
first read on whether any of this works. Land it early and let it accumulate
data while Phases 3–4 are built.

1. `mem-prompt.ts` — append the citation instruction to the retrieved block only
   (never to the cached guidance block):
   `If any of the above shaped your answer, end your reply with <memory-used>type/name, …</memory-used>`.
2. `memory/citations.ts` — `parseMemoryUsed(text): { ids: string[]; stripped: string }`.
   Tolerate a code-fenced tag, whitespace, and a trailing period. Unparseable →
   `{ ids: [], stripped: text }`. Never throws.
3. `memory/usage-store.ts` — `.graph/usage.json` keyed by `type/name`, holding
   `useCount`, `lastUsedAt`, `injectedCount`. Debounced writes, off the hot path.
   A missing or corrupt file reads as all-zero.
4. `agent/loop.ts` — call `recordInjected()` where `memory_injected` is already
   emitted (~`loop.ts:1297`), and on turn end strip the tag from assistant text
   and `recordCited()` the **intersection** with what was actually injected. A
   cited name never surfaced is discarded.
5. `memory/citations.test.ts` and `memory/usage-store.test.ts` per spec §8.
6. `freecode memory graph stats` — show `useCount / injectedCount` per memory,
   sorted. This is the whole payoff of the phase being visible.

**Verify:** run a real session with a populated store; `usage.json` shows
non-zero `injectedCount` for surfaced memories and `useCount` only where the
model cited. Delete `usage.json` mid-session — nothing throws, counters restart.
Confirm the tag never reaches user-visible output (TUI and `session.export`).

**Watch for:** models that ignore the instruction. If `useCount` stays at zero
across providers after a week, D12 has failed and Phases 4–5 fall back to the
age- and cosine-only behaviour originally specified. Say so rather than tuning
the prompt indefinitely.

---

## Phase 3 — Session end (D3, D4)

A session-lifecycle fix that happens to unblock memory. Its own commit; valuable
without the rest.

1. `session/manager.ts` — `endSession(sessionId, reason: SessionEndReason)` where
   the reason is `"switch" | "archive" | "stop" | "delete" | "exit"`. Runs the six
   per-session disposers, then fires the flush. **Idempotent per `sessionId`** —
   switch away and back must not flush twice.
2. `server.ts` — call it from `session.switch`, `.archive`, `.stop`, `.delete`
   (replacing the lone `disposeSessionMemory` at `server.ts:967`) and the
   `process.on("exit")` path (`server.ts:1111`, which today only disposes hook
   settings).
3. `memory/extract-policy.ts` — a `force` option that bypasses **gate 6 (the
   interval) and nothing else**. Kill switches, "model already saved", and the
   200-char minimum all still apply.
4. `memory/extract.ts` — accept and pass `force`.
5. `reason: "exit"` gets a bounded ~2 s wait; everything else stays
   fire-and-forget.
6. `session/manager.test.ts` (extend) — all six disposers run, idempotent, and
   each of switch/archive/stop/delete reaches it.
   `extract-policy.test.ts` (extend) — `force` bypasses the interval and nothing
   else: each kill switch and the too-short gate still block a forced flush.

**Verify:** start a session, state a preference, end it at run 2 (below the
interval), and confirm a memory is written. That is MEMORY_SYSTEM §10 gap 1
closing. Then confirm the six caches are gone for a session ended by `switch` —
the leak this phase actually fixes.

---

## Phase 4 — Episodes (D5, D6)

1. `memory/mem-types.ts` — `"episode"` into `MemoryType` and `MEMORY_TYPES`;
   parse and serialize `happened_at` (ISO date, optional). Back-compatible in
   exactly the way `tags`/`supersedes` were — absent means undated, every
   existing file parses unchanged.
2. `tools/memory.ts` — reject `type: "episode"` on `save` with a message pointing
   at the four durable types. `list` and retrieval expose episodes normally: the
   model reads its history, it does not author it.
3. `memory/graph/builder.ts` — `happened_at` onto the node so `/graph` can show it.
4. `graph/index.ts` — for `type: "episode"` only, multiply the cascade score by
   `max(0.25, 0.5 ** (ageDays / 30)) · (1 + 0.1 · ln(useCount + 1))`, reading
   `useCount` from Phase 2. Semantic types unmultiplied.
5. `mem-prompt.ts` — a `## Episode` section of `- YYYY-MM-DD — description`
   lines, newest first, always one line each.
6. Round-trip test the write path never got: save → episode → `retrieve()`
   returns it; a 400-day-old episode ranks below a same-week one for the same
   query; **and a heavily-used 400-day-old episode ranks above an unused
   same-month one** (that last assertion is what makes step 4 worth its
   complexity — if it cannot be made to pass, drop the use term).

**Verify:** extend the Phase 0 corpus with dated episodes and sweep
`EPISODE_HALF_LIFE_DAYS` ∈ {14, 30, 90}; record which maximises recall on
temporally-scoped queries. `MAX_EPISODES = 50` is enforced by Phase 5 only —
until then episodes accumulate, demoted but not deleted (spec §7).

---

## Phase 5 — Consolidation (D7–D11, D13)

The merge/prune pass. Everything before this exists so that this phase's inputs
are evidence rather than guesses.

### 5a — The git baseline (D13)

1. `memory/git-baseline.ts` — `ensureRepo()`, `diffSinceBaseline()`,
   `commitBaseline()`. `git` as a subprocess (the `context/tree-cache.ts`
   pattern); `.graph/` in `.gitignore`. **Every function degrades to a no-op or
   "no diff available" when `git` is missing or the repo is corrupt**, logged
   once per process.
2. `memory/git-baseline.test.ts` — a diff after edits lists exactly the changed
   files; a failed consolidation leaves the baseline unmoved so the next diff
   spans both windows; with `git` unavailable nothing throws.

**Verify:** `git log` inside `~/.freecode/projects/<key>/memory/` shows one
commit per successful consolidation and nothing else. Delete `.git` — the next
consolidation still runs, on heuristic candidate selection.

### 5b — Gates and lock (D7, D8)

3. `memory/consolidation-lock.ts` — `readLastConsolidatedAt()` (one `stat`),
   `tryAcquireConsolidationLock()` (advancing the mtime *is* the acquire),
   `rollbackConsolidationLock(prior)`. Plus a sidecar recording the three-way
   outcome (`succeeded` / `succeeded_no_output` / `failed`) and `retryAt`, so a
   healthy no-op advances the schedule and a transient failure retries in minutes
   rather than losing a day.
4. `memory/consolidate-policy.ts` — the five gates, cheapest first: kill switches
   (`memory.autoConsolidate`, `FREECODE_DISABLE_MEMORY_CONSOLIDATION`), time
   (`minHours 24`), scan throttle (10 min), sessions (`minSessions 5` via
   `SessionStore.list({ projectPath })`, current session excluded,
   `turnCount < 2` skipped), lock. Plus the rate-limit guard: skip if this
   process has seen a provider rate-limit error.

### 5c — The call (D9, D11)

5. `memory/consolidate.ts` — assemble the input (index + D13 diff ≤ 64 KB +
   ≤ 20 candidates selected per spec D9, each annotated `used: n times, last
   <date>`), make **one** `provider.execute()` on the default model, validate
   strictly, apply under caps (`MAX_MERGES 5`, `MAX_PROMOTES 3`, 1 episode,
   `supersedes` names must have been sent, secret filter on every write).
   **No bare delete verb.** Never throws.
6. `agent/loop.ts` — fire from `kickMemoryExtraction()`'s slot at the
   `complete("Done", …)` branch, **mutually exclusive with extraction**. One
   memory-related provider call per completion, maximum, ever. Not from
   `TurnEnd`, not from `Stop`. Subagents are already excluded
   (`agent/subagent.ts:70`).
7. Reuse the `memory.saved` bus event with `verb: "Improved"` — *"Improved 3
   memories and recorded 1 episode."* The bus speaker is subscribed at startup
   (`server.ts:1080`), which is required: consolidation finishes after the turn's
   `done`.
8. `memory/consolidate.test.ts` and `consolidate-policy.test.ts` per spec §8. The
   load-bearing ones: a secret-bearing merge writes nothing **and deletes
   nothing**; a `supersedes` name never sent is dropped while siblings apply;
   malformed and throwing completions apply nothing and do not reject.

**Verify:** seed a store with three near-duplicates, force a run, and confirm one
merged memory carrying `supersedes:` plus the originals deleted — **the first
`Supersedes` edges the graph has ever actually contained.** Then measure: spec §6
predicts precision@5 improves at constant token cost. If the delta is zero on a
corpus built with deliberate duplicates, say so and consider cutting D9 — the
spec commits to being willing to reach that conclusion.

---

## Cross-cutting

- **Docs.** `MEMORY_SYSTEM.md` (§2 layout, §3 write path, §10 gaps, §11
  comparison) and `apps/docs/app/internals/memory/page.mdx` (episodic +
  consolidation; its Known gaps shrink) update with the phase that makes them
  wrong, not at the end.
- **`permission/mode-policy.ts` — no change.** `memory` stays out of
  `READONLY_TOOLS` (write-path D7). Listed so the tool checklist shows it was
  considered.
- **Land before Phase 5, not blocking:** the project-key collision
  (`mem-store.ts:31` keys on `path.basename()`). Tolerable for "user prefers
  tables", actively wrong for episodes — the most project-specific thing the
  store will ever hold. `store/path-formatter.ts` already solves it for sessions;
  reuse it, plus a rename migration for existing `~/.freecode/projects/`.
- **Land before Phase 5:** the `VectorStore` id→index `Map` (TODO.md). D9's
  pairwise-cosine selection makes the O(n²) sync matter sooner.
- **`RetrievalOutcome` (D14, second half)** — `{ fused, vector_only,
  lexical_only, empty_by_floor, embedder_unavailable, error }` recorded on the
  rollout stream, added in Phase 1 where the branches are introduced. jcode's
  point is that a silent fallback is a bug class, not a safety net; defect 3
  existed for as long as it did because nothing named it.
