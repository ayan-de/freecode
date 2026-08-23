# Memory Consolidation & Episodic Recall

> **Date:** 2026-08-23
> **Status:** 📋 Proposed — not implemented.
> **Extends:** `specs/2026-07-26-memory-knowledge-graph.md` (read side) and
> `specs/2026-08-09-memory-write-path.md` (write side). Closes that spec's
> §11 gaps 1 and 2, and its §10 open decision 4 ("no consolidation").
> **Related:** `specs/2026-08-05-token-efficiency.md`, `specs/2026-08-09-cache-observability.md`
> **Prior art studied (all read at their working trees on 2026-08-23):**
> `claude-code` — `services/autoDream/`, `services/extractMemories/`, `memdir/`;
> `codex` — `codex-rs/memories/{read,write,mcp}/`, `state/migrations/{0006_memories,0016_memory_usage}.sql`,
> `write/templates/memories/consolidation.md`. **The richest of the five and the
> primary source for D12–D14**;
> `jcode` — `crates/jcode-memory-types/`, `src/bin/memory_recall_bench.rs`,
> `crates/jcode-base/src/memory_judge_metrics.rs`;
> `waku-agent` — `waku/memory/{consolidation,retrieval_gate}.py`, `docs/architecture.md`;
> `mem0` — `mem0/configs/prompts.py` (the ADD/UPDATE/DELETE/NONE loop, and its
> v3 retreat to ADD-only);
> `agentmemory` — `benchmark/{LONGMEMEVAL,QUALITY}.md`, `benchmark/longmemeval-bench.ts`;
> `opencode` — checked and found to have **no** persistent memory subsystem
> (`session/instruction.ts` loads `AGENTS.md`; nothing more). Not a reference here.
> Also checked and empty: `aider`, `pi` (session storage only), `Graft`, `rlm`,
> `agent-sturdy`, `deepseek-harness` (third-party memory-MCP config examples only).
> **Companion plan:** `docs/superpowers/plans/2026-08-23-memory-consolidation.md`

---

## 1. Problem

The write path shipped and the store now fills. Four consequences follow that
nothing in the system currently handles. (The fourth was added on the
prior-art review below, and it is the one that makes the other three tractable.)

**1. The store only grows.** `extract.ts` saves up to 3 memories per gated
completion and the model saves more through the tool. Nothing ever merges,
demotes, or deletes. `supersedes:` is parsed (`mem-types.ts:101`) and carries the
heaviest cascade weight in the graph (0.9, `graph-types.ts:30`) but **no writer
has ever emitted one** — so `Supersedes` edges do not exist in practice, and
neither do `Contradicts` edges (TODO.md, "Real fixes"). Near-duplicate memories
therefore all match the same query, and three variants of one fact take three of
the eight retrieval slots.

**2. Episodic memory is logged but never distilled.** The substrate exists and is
good: rollout event sourcing plus the thread store put every turn on disk,
replayable and resumable — 390 session directories under
`~/.freecode/rollout/sessions/` today, plus per-project `messages.jsonl`. What is
missing is the layer above it. Raw event JSONL is unsearchable at the semantic
level and far too large to inject, and all four *retrievable* memory types —
`user`, `feedback`, `project`, `reference` — are semantic: things that are
*durably true*. So a query like "what did we decide about the SSE timeout last
month" has nothing to hit, and a fact that only becomes obvious the fifth time it
happens is never learned. The standard flow is **working → episodic → semantic**;
FreeCode does the first arrow and skips the second, because extraction reads the
*live* transcript and nothing ever revisits the archive.

This is the framing used in `apps/docs/app/internals/memory` ("logged, never
distilled", and gap 1: "the largest structural gap") — the two documents agree,
and should stay agreeing.

**3. Retrieval has no confidence floor, and the injected block has no ceiling.**
Two defects found while writing this spec, both independent of consolidation:

- `MemoryGraphService.seed()` (`graph/index.ts:253`) falls back to
  `findRelevantMemories()` whenever `cosineTopK(10, 0.4)` returns nothing, and
  `retrieve()` does it again at the end (`out.length > 0 ? out : fallback()`).
  The keyword scorer's floor is `score > 0`, where `score()` (`mem-query.ts:19`)
  awards +5 per description token pair and +1 per content token pair for any
  *substring* overlap in either direction (`add`↔`address`, `run`↔`running`),
  with **no IDF and no length normalization** — so a long memory outscores a
  precise one on stopword-ish overlap alone. When the vector store says
  *nothing here is relevant*, that scorer overrides it and injects up to 8
  memories anyway. The keyword path is specified as the **embedder-unavailable**
  fallback (KG spec D6); it is also acting as the **no-good-match** fallback,
  which is a different question with a different right answer.

  Note the diagnosis carefully, because the obvious fix is wrong: the problem is
  **this scorer**, not lexical retrieval. agentmemory's measurements
  (`benchmark/QUALITY.md`) put BM25-only at 95.0% P@5 / 95.5% MRR against
  dual-stream's 90.0% / 95.4%, and BM25+vector within 1.4pp of vector-only on
  LongMemEval-S. Lexical retrieval done properly is a peer of the vector path,
  not a degraded stand-in for it. D1 therefore replaces the scorer and fuses,
  rather than gating the fallback off.
- `renderRetrievedMemories()` (`mem-prompt.ts:128`) emits **full bodies** for up
  to 8 entries with `cache: false` (`agent/loop.ts:1325`). There is no byte cap.
  claude-code caps its always-injected entrypoint at `MAX_ENTRYPOINT_BYTES =
  25_000` precisely because unbounded memory injection is how this ends.

Both are tracked in `TODO.md`.

**4. Nothing ever learns whether an injected memory was any use.** The loop
already knows exactly which memories it surfaced for a given user message — it
emits them as a `memory_injected` stream event (`agent/loop.ts:1297`) — and then
throws that knowledge away. No memory carries a use count, a last-used date, or
any trace of having earned its slot. Three things fall out of that absence:

- Consolidation has no principled way to pick candidates, so D9 originally
  reached for "highest pairwise cosine" — a proxy for *similar*, which is not
  the same question as *worth keeping*.
- Decay (D6) can only be a function of age, when the thing that actually
  distinguishes a live memory from dead weight is whether it keeps getting used.
- §6's claim that consolidation improves recall quality is unfalsifiable.

codex closes this loop and it is the single highest-leverage idea in any of the
five references: the model **cites** the memory it used, and those citations
become `usage_count` / `last_usage` columns that drive selection and retention
(`state/migrations/0016_memory_usage.sql`, `read/src/citations.rs`). D12 adopts it.

**Framing this correctly matters.** Consolidation is a **recall-quality** feature,
not a cost-saving one — see §6. The only genuine token savings in this spec are
D1 and D2, which cost nothing to build and involve no model call.

## 2. Prior art

|                                  | freecode (today)                          | codex                                  | claude-code                            | jcode                          | waku-agent                     |
| -------------------------------- | ----------------------------------------- | -------------------------------------- | -------------------------------------- | ------------------------------ | ------------------------------ |
| Semantic memory                  | ✅ markdown + 384-d ONNX vectors + graph cascade | ✅ `MEMORY.md` handbook + `memory_summary.md` index | ✅ markdown + LLM picks ≤5 from a manifest | ✅ graph + MiniLM, same shape as ours | ✅ facts table, FTS5 / pgvector |
| Procedural memory                | ✅ `skills/`                               | ✅ **consolidation writes `skills/`**  | ✅ skills                              | —                              | ✅ `SKILL.md`                  |
| **Episodic memory**              | ~ raw rollout JSONL — logged, replayable, **never distilled or retrievable** | ✅ `rollout_summaries/*.md`, one per mined rollout | ~ daily logs (`logs/YYYY/MM/*.md`), assistant-mode only | ~ session-scoped               | ✅ `episodes` table, dated      |
| Per-session extraction           | ✅ gated (`extract-policy.ts`)             | ✅ Phase 1, per *finished rollout*, ×8 parallel | ✅ every completed loop                 | ✅                             | —                              |
| **Batch consolidation**          | ❌                                         | ✅ Phase 2, global lock, stronger model | ✅ `autoDream` — 24h **and** 5 sessions | ~ background maintenance       | ✅ every N chats                |
| **Merge / prune / delete**       | ❌                                         | ✅ driven by a git diff of inputs      | ✅ dream phases 3–4                     | ✅ supersede → `active=false`  | ~ appends only                 |
| **Usage feedback**               | ❌                                         | ✅ **citations → `usage_count`/`last_usage`** | ❌                                     | ✅ `access_count`, `strength`, `reinforcements` | ❌                             |
| **Decay / forgetting**           | ❌                                         | ✅ `max_unused_days` window            | ❌                                     | ✅ `effective_confidence`, age + use | ❌                             |
| Retrieval gate                   | local cosine, every turn, no model call    | progressive disclosure via memory-fs MCP | LLM picks from a manifest              | ✅ listwise consensus rerank, with cadence carry | ✅ cheap-model yes/no judge     |
| **Recall measured?**             | ❌                                         | ~ usage telemetry only                 | ❌                                     | ✅ `memory_recall_bench` — recall@k / MRR / nDCG | ❌                             |
| Store                            | files (truth) + rebuildable `.graph/` sidecar | files **in a git repo** + SQLite job/usage state | files                                  | graph on disk                  | one SQLite file (+ 4 hosted backends) |

### What we take, and from where

**claude-code's `autoDream` gate shape and lock.** Two gates, cheapest first —
`minHours: 24` **and** `minSessions: 5`, the current session excluded — plus a
scan throttle for the case where the time gate passes but the session gate
doesn't. The lock is the part worth stealing outright: a file whose **mtime *is*
the last-consolidated timestamp**, so the gate is one `stat`, there is no
separate state file to keep in sync, and failure recovery is "restore the prior
mtime" (`consolidationLock.ts` — `readLastConsolidatedAt`,
`tryAcquireConsolidationLock`, `rollbackConsolidationLock`). We take all of it.

**claude-code's dream *phases*.** Orient → gather → **merge into existing files
rather than creating near-duplicates** → **prune the index and delete contradicted
facts**. The merge/prune half is the entire value; a consolidator that only
appends is a slower extractor.

**waku's separation of episodic from semantic**, and its consolidation contract:
one cheap-model call over the unconsolidated log returning
`{"facts": [...], "episode": "<one sentence>"}`, with the log marked consolidated
only on success (`consolidation.py`). Loss-safe by construction — if the
summarizer fails the log stays unconsolidated and the next run covers it. That is
the same "throttling loses nothing" property the write path already relies on
(D5a), and we keep it.

**codex's citation → usage loop.** The read path teaches the model to emit
`<citation_entries>path:12-18|note=[…]</citation_entries>`; `read/src/citations.rs`
parses it and `0016_memory_usage.sql` accumulates `usage_count` / `last_usage`;
Phase 2 then ranks candidates by usage and drops anything unused past
`max_unused_days`. This turns every guess in this spec — which memories to
consolidate, which to demote, whether any of it helps — into a measurement. **D12.**

**codex's git-baseline workspace diff.** The memory root *is* a git repo
(`~/.codex/memories/.git`); each consolidation is handed
`phase2_workspace_diff.md`, the diff from the last **successful** run to the
current worktree, and told that "every change in the diff is authoritative".
Change detection, rollback, and the forgetting rule (*a deleted input file means
delete the memory that only it supported*) all fall out of one mechanism we get
from a tool already on every developer's machine. **D13.**

**codex's job discipline.** Outcomes are `succeeded` / `succeeded_no_output` /
`failed`, with leases, retry backoff, and a rate-limit guard (`guard.rs`) that
skips background memory work when the account's quota is nearly spent. Strictly
better than D8's original "a crash means no retry for 24 h" — folded into **D8**.

**jcode's recall benchmark.** `memory_recall_bench.rs` replays real sessions into
query windows, runs the *production* retrieval primitives over them, and reports
recall@k / MRR / nDCG per config while accounting for each config's LLM calls and
tokens — so two retrieval designs are compared at equal cost. Its corpus lives
outside the repo for privacy. Together with agentmemory's LongMemEval-S harness
this closes what §11 previously left open as "principled, not measured". **D14.**

**jcode's use-aware decay.**
`effective_confidence = confidence · e^(−age/half_life·ln2) · (1 + 0.1·ln(access_count+1))`
(`jcode-memory-types/src/lib.rs:352`), plus `reinforcements` breadcrumbs recording
when and where a memory was re-confirmed. Age alone demotes a fact that is simply
old; age *against* use demotes a fact nobody needed. Revises **D6**.

**mem0's retreat from `DELETE`.** mem0 v2 gives the model ADD / UPDATE / DELETE /
NONE over retrieved neighbours (`configs/prompts.py:176`); its v3 extraction
prompt is **ADD-only**, with relationships expressed as `linked_memory_ids`
instead. A memory library that started with a delete verb and walked it back is
independent confirmation of D9's "no bare delete" — recorded here because §10.1
flags it as the decision most likely to be argued with.

### What we decline, and why

**An LLM retrieval judge — declined, but the argument has changed.** waku gates
retrieval behind a cheap-model yes/no call. The original objection here was that
this costs **one extra provider round-trip per user turn** to avoid work that
costs microseconds (our cosine is in-process over a packed `Float32Array`, run
one-turn-behind so the loop never waits on it — KG spec D5, `COLD_BUDGET_MS = 60`),
and that waku's gate *fails open*, so on error you pay for the gate and retrieve
anyway. That objection lands against waku's shape.

It does **not** land against jcode's. jcode runs a listwise consensus rerank and
treats its *absence* as a defect to be measured and driven to zero
(`memory_judge_metrics.rs`), and it defuses the cost argument with a **cadence
carry**: re-surface the previously judged set without a fresh rerank, which its
own metrics classify as intended rather than degraded. Run one-turn-behind on our
existing prefetch (`kickPrefetch`), a judge would add zero latency to the loop and
fire on a fraction of turns.

We still decline it **for now**, on sequencing rather than principle: a judge is a
reranker over the candidate set, and we have no way to tell whether it helps until
D14 exists. Building the measurement before the thing it would measure is the whole
point of doing D14 first. **Revisit once D14 reports a baseline** — that is a
concrete condition, not a polite deferral. What we adopt from jcode immediately is
the *metric* discipline (D14) and the observation that a silent fallback is a bug
class, not a safety net — which is exactly defect 3.

**codex's SQLite-backed job queue** (`jobs` table, leases, ownership tokens,
`Stage1JobClaimOutcome`'s five-way result). Correct for codex, which runs Phase 1
across many rollouts ×8 in parallel and must prevent duplicate work between
concurrent processes. We consolidate one project at a time, serially, at most
daily. We take the *outcome taxonomy and retry backoff* (D8) and leave the queue.

**codex's progressive disclosure** — a small always-loaded `memory_summary.md`
plus full bodies fetched on demand through a read-only memory-filesystem MCP
server (`memories/mcp/`). This is a genuinely better answer to the problem D2
solves by truncation: instead of capping the injected block, make the block an
index and let the model fetch what it wants. We decline it here because it is a
*read-path* redesign — new MCP surface, extra tool round-trips, and it interacts
with prompt caching — and this spec is already four phases long. Recorded in §11
as the successor to D2 rather than as a gap.

**waku's pluggable backends** (`SqliteFactStore` / Supabase / mem0 / zep /
langmem). waku is a teaching repo; four backends exist to demonstrate the upgrade
path. Adopting any would trade our load-bearing invariant — *markdown files are
the only source of truth, `.graph/` is derived and deletable at any time*
(MEMORY_SYSTEM §1) — for vendor surface and a network dependency in the read
path.

**waku's separate episodic table.** Correct for waku, which has no unified store.
We have one, and D5 explains why an episode is a memory type rather than a second
storage system.

**claude-code's tool-using dream agent.** `autoDream` runs
`runForkedAgent(...)` — a full agent loop with read-only bash, `grep` over
transcript JSONL, and write access scoped to the memory directory. It affords
this because the fork rides the parent's prompt cache. We have no forked-agent
primitive: `SubagentType` (`agent/types.ts:38`) is a closed union of five types
and `SubagentConfig` carries no tool allowlist — the same fact that revised D6 of
the write path. A fresh, full-price agent loop turned loose with `grep` over 390
rollout directories has no cost ceiling. **D9 does it as one structured call over
a deterministically-assembled input instead.**

## 3. Goals

- **The store stops growing monotonically.** Near-duplicates merge; superseded
  memories are deleted by the writer that supersedes them.
- **"What happened, when" becomes answerable** without reading a rollout.
- **Bounded prompt cost.** The injected memory block has a hard byte ceiling, and
  a turn with no relevant memory injects nothing.
- **Bounded model cost.** Consolidation is at most one cheap-model call per
  project per day, and never runs in the same completion as an extraction.
- **Retention becomes evidence-based.** Which memories survive consolidation is
  decided by whether they have been used, not by how similar they look.
- **Recall quality is measured.** A change to retrieval reports recall@k / MRR /
  nDCG against a fixed corpus before it ships, so §6's quality claim is testable.
- **Never break the loop.** Unchanged from the write path: a memory failure is
  invisible to the user's task.
- **`.graph/` stays deletable.** No new source of truth.

### Non-goals

- Any change to embedding, clustering, the cascade, or `/graph` rendering beyond
  the new node kind.
- Contradiction *detection* (`Contradicts` edges). Consolidation produces
  `Supersedes`, which is the case where the writer already knows. Detecting that
  two independently-written memories disagree stays open (TODO.md).
- Bi-temporal validity (TODO.md). Episodes carry one date, not a validity range.
- Cross-project or global memory. Per-project, as today.
- An LLM reranker over retrieval results.
- Learned procedural memory — distilling a successful tool sequence into a skill
  (TODO.md). Different subsystem, different spec.

## 4. Key design decisions

### D1 — Fix the lexical scorer and fuse it, rather than gating it off

An earlier draft of this decision suppressed the keyword fallback whenever the
embedder was available and `cosineTopK` returned nothing — treating a confident
vector miss as a real answer. The reasoning was that a "strictly weaker scorer"
should not override a strong one. **The premise was wrong**, and agentmemory's
measurements are the reason: BM25-only reaches 95.0% P@5 / 95.5% MRR on their
labelled set (dual-stream: 90.0% / 95.4%), and BM25+vector lands within 1.4pp of
pure vector search on LongMemEval-S while beating it on ranking quality. Lexical
retrieval is a peer signal. What is weak is *our* lexical scorer.

So D1 does three things:

**1. Replace `score()` with BM25.** `mem-query.ts:19` currently awards +5/+1 per
substring-overlapping token pair, with no IDF and no length normalization. BM25
(`k1 = 1.2`, `b = 0.75`) over a corpus of a few hundred short documents is ~40
lines and needs no dependency: term frequencies are computed at sync time
alongside the embeddings and cached in the same sidecar. Description tokens keep
a field boost so the current +5/+1 intent survives; exact-name match keeps its
bonus.

**2. Fuse instead of falling back.** `seed()` stops choosing between vectors and
keywords and combines both with reciprocal rank fusion:

```
rrf(d) = Σ_r 1 / (RRF_K + rank_r(d))     RRF_K = 60
```

RRF is the right fusion here specifically because it needs no score calibration —
cosine similarity and BM25 scores are not on comparable scales, and RRF only ever
reads ranks. Both retrievers contribute `K_INITIAL` candidates; the fused top-k
seeds the cascade unchanged.

**3. Keep a floor, now on the fused score.** The original defect is real and still
gets fixed: a query matching nothing must inject nothing. But the floor now sits
after fusion, where it has both signals to judge on, instead of being implemented
as "distrust one retriever entirely". The terminal `out.length > 0 ? out : fallback()`
in `retrieve()` (`graph/index.ts:297`) goes away — an empty cascade over fused
seeds is an answer, not a failure to answer. On "what's 2+2" with a populated
store, today's behaviour injects up to 8 memories; after D1 it injects none.

`!embedder.available()` still degrades to lexical-only, exactly as KG spec D6
requires — that path is now *better*, not merely tolerable, which is the second
argument for doing it this way.

`memory.query` (the IPC method, used by `/graph` search) keeps the permissive
behaviour — an explicit search should show weak matches. The floor applies to
*automatic injection* only.

**This is the one part of the spec that must not ship unmeasured.** D1 changes
what gets retrieved for every turn of every session; "principled" is not good
enough. D14 exists first so that D1 reports a before/after.

### D2 — A byte ceiling on the injected block, with tiered degradation

`renderRetrievedMemories()` gains a hard cap, `MAX_MEMORY_BLOCK_BYTES = 2048`.
Entries are emitted in cascade-score order; once the budget is spent, remaining
entries degrade to a single `- name — description` line, and past that they are
dropped. Episodes (D5) are *always* one line — they are one sentence by
construction, so a full-body render would be the same text with extra ceremony.

Why a byte cap rather than a smaller `limit`: the failure mode is not "too many
memories", it is "one memory with a 4 KB body". A count cap cannot see that.

**Implementation note:** "cascade-score order" is not available at the render
site today. `retrieve()` (`graph/index.ts:288`) walks the scored cascade output
but returns bare `MemoryEntry[]`, discarding the score, and `prepareMemories`
stashes that. Degrading by score requires plumbing the score through both — a
`RetrievedMemory = { entry, score }` shape, changed in `retrieve()`,
`prepareMemories`, the session stash, and `renderRetrievedMemories`. Small, but
it is not a one-file change, and D12 needs the same plumbing to know what it
injected.

**codex does better than this and we should eventually follow.** Its always-loaded
artifact is a navigational index (`memory_summary.md`) with bodies fetched on
demand through a read-only memory-fs MCP server — progressive disclosure instead
of truncation, so a long memory is never *cut*, merely *not yet read*. D2 is the
cheap version. §11 records the successor.

The block stays `cache: false` at the tail of the system array
(`agent/loop.ts:1325`) — unchanged, and load-bearing: it must not move into the
cached static prefix (write-path D2).

### D3 — One session-end signal, and everything hangs off it

`disposeSessionMemory` has exactly one call site (`server.ts:967`, inside
`session.delete`). Six per-session caches hang off that handler, so all six leak
for a session that ends by `switch`, `archive`, `stop`, or process exit — already
filed in TODO.md as **"Do this first."** It is also a hard prerequisite here: D4
needs it, and D7's session gate is far more accurate when sessions have a
recorded end.

Introduce `endSession(sessionId, reason)` in `session/manager.ts`:

```ts
type SessionEndReason = "switch" | "archive" | "stop" | "delete" | "exit";
```

It runs the six disposers, then fires D4's flush. Called from `session.switch`,
`session.archive`, `session.stop`, `session.delete`, and the `process.on("exit")`
path (`server.ts:1111`, which today only disposes hook settings). Idempotent per
`sessionId` — `switch` away and back must not flush twice.

This is a session-lifecycle fix that happens to unblock memory. It should land on
its own commit and is independently valuable.

### D4 — End-of-session flush: the throttle's missing half

The write path's interval gate (`extractEveryNRuns`, default 8) means **a session
that ends at run 5 extracts nothing** — MEMORY_SYSTEM §10 gap 1, and the reason
"user states a preference in a one-shot session and it is lost" is still true.

`endSession` calls `extractMemories()` with `force: true`, which bypasses gate 6
(the interval) but **not**:

| Gate | Still applies? | Why |
| --- | --- | --- |
| 1–2 · env + settings kill switches | ✅ | A kill switch that a code path can bypass is not a kill switch |
| 3 · model already saved this run | ✅ | Unchanged rationale — it already said what it wanted kept |
| 4 · transcript too short | ✅ | `< 200` chars still never held a memory |
| 5 · topic change | n/a | Only ever *forces* extraction |
| 6 · interval | ❌ **bypassed** | This is the whole point |

Both jcode (`trigger_final_extraction_with_dir`) and waku (consolidation runs on
the accumulated log regardless of session boundaries) do the equivalent.
`reason: "exit"` gets a bounded wait (~2 s) since the process is leaving;
everything else stays fire-and-forget.

### D5 — `episode` is a fifth memory type, not a second store

`MemoryType` becomes `"user" | "feedback" | "project" | "reference" | "episode"`.

Everything downstream is then free: frontmatter parse/serialize, `MemoryStore`,
`MEMORY.md` indexing, `onMemoryChange` → incremental embed, graph nodes and
edges, cascade, `/graph`, the explorer, `memory.*` IPC, `freecode memory graph
stats`. A separate episodic store would require re-implementing every one of
those, and would break the "one directory of markdown is the truth" invariant
that makes `.graph/` safely deletable.

An episode file:

```markdown
---
name: 2026-08-23-sse-timeout-decision
description: Settled on a 180s SSE stall timeout at the fetch layer
type: episode
happened_at: 2026-08-23
tags: streaming, timeouts
---
Chose a 180s silence timeout on live SSE streams over a total-duration cap,
after a large tool call was misread as a dead stream. See [[fetch-timeout-policy]].
```

`happened_at` is a new optional frontmatter field (ISO date), back-compatible in
exactly the way `tags`/`supersedes` were: absent means "undated", and every
existing file parses unchanged.

**Episodes are machine-written only.** `tools/memory.ts` rejects
`type: "episode"` on `save` with a message pointing at the durable types — the
model narrating its own session into memory is the noise failure mode this whole
spec exists to prevent. `list` and retrieval expose episodes normally; the model
can *read* its history, not author it.

**Rendering** (D2): a single `## Episode` section of `- YYYY-MM-DD — description`
lines, newest first.

### D6 — Episodes decay and are capped; semantic facts do not

The gap neither reference implementation closes: waku's `episodes` table and
claude-code's daily logs both grow without bound. An episodic store that only
accumulates eventually crowds out the durable facts it was meant to complement.

Two mechanisms, both cheap and both local:

1. **Decay multiplier at retrieval, discounted by use.** For `type: "episode"`
   only, multiply the cascade score by

   ```
   max(0.25, 0.5 ** (ageDays / EPISODE_HALF_LIFE_DAYS)) · (1 + 0.1 · ln(useCount + 1))
   ```

   with `EPISODE_HALF_LIFE_DAYS = 30`. The first factor is pure age; the second
   is jcode's access boost (`jcode-memory-types/src/lib.rs:352`), reading
   `useCount` from D12. Age alone demotes an episode for being old; age against
   use demotes one nobody needed — a decision the user keeps hitting stays near
   the top for months, while a busy afternoon nobody ever asked about sinks. The
   0.25 floor means a two-year-old episode that is *strongly* on-topic can still
   surface — decay demotes, it does not erase.

   **Semantic types are unmultiplied.** "User prefers tables" does not get less
   true, and jcode's confidence decay is deliberately *not* adopted for them:
   demoting a durable fact for being old is how a system forgets a standing
   instruction. Use is still recorded for all types (D12) — it drives D9's
   candidate selection — it just does not touch semantic retrieval scores.

2. **Retention cap.** `MAX_EPISODES = 50` per project. Consolidation (D9) is
   handed the overflow — **least-used first, age breaking ties**, rather than
   simply oldest — and told to fold anything durable in them into a semantic
   memory before they are deleted. Deletion happens in our code after the call
   returns, not by the model.

Both constants are guesses, and are declared as such in §10 alongside the
existing ones. Unlike the others, these two are now *measurable*: D14's harness
can replay a corpus at several half-lives and report which one maximises recall
on temporally-scoped queries.

### D7 — Two gates plus a lock, using data we already have

Gate order, cheapest first, mirroring `autoDream`:

| # | Gate | Default | Cost | Source of truth |
| - | ---- | ------- | ---- | --------------- |
| 1 | Kill switches: `memory.autoConsolidate`, `FREECODE_DISABLE_MEMORY_CONSOLIDATION` | on | — | `extract-policy.ts` settings loader, reused |
| 2 | `hoursSince(lastConsolidatedAt) >= minHours` | 24 | one `stat` | lock-file mtime (D8) |
| 3 | Scan throttle | 10 min | one comparison | in-process, per claude-code |
| 4 | `count(sessions with lastTurnAt > lastConsolidatedAt) >= minSessions`, current session excluded | 5 | one `list()` | `SessionStore.list({ projectPath })` |
| 5 | Lock acquired | — | one `utimes` | D8 |

Gate 4 is where we improve on the prior art. claude-code scans a transcript
directory and compares file mtimes. We already have
`SessionStore.list({ projectPath })` returning `SessionMeta[]` with
`lastTurnAt`, `turnCount`, and `status` — project-scoped, no directory walk, no
mtime heuristics, and it correctly ignores sessions from *other* projects that
happen to share a machine. Sessions with `turnCount < 2` are skipped; they held
nothing.

**Where it fires.** From `kickMemoryExtraction()`'s fire-and-forget slot at the
`complete("Done", …)` branch (`agent/loop.ts`), **mutually exclusive with
extraction**: if `shouldExtract()` returned true this completion, consolidation
does not run. One memory-related provider call per completion, maximum, ever.
Not from `TurnEnd` (fires per inner turn) and not from `Stop` (abnormal
termination only) — same reasoning as write-path D5.

**Subagents never consolidate.** `memoryExtraction: false` already gates the
whole slot (`agent/subagent.ts:70`).

### D8 — The lock file's mtime is the timestamp, with codex's retry discipline

Taken from claude-code's `consolidationLock.ts` essentially unchanged, at
`<memoryDir>/.graph/consolidation.lock`:

- `readLastConsolidatedAt()` → `stat().mtimeMs`, or `0` if absent.
- `tryAcquireConsolidationLock()` → returns the prior mtime and sets mtime to
  now, or `null` if another process moved it first. Advancing the mtime *is* the
  acquire, so a crashed run self-heals after `minHours` rather than wedging a
  stale lock forever.
- `rollbackConsolidationLock(priorMtime)` on failure — rewind so the time gate
  passes again; the scan throttle is the backoff.

No new state file, no JSON to keep consistent, and the gate is one `stat`. It
lives under `.graph/` because it is derived state: deleting the sidecar resets
the schedule, which is correct.

**Two amendments from codex**, both cheap:

- **A three-way outcome, not two.** codex distinguishes `succeeded`,
  `succeeded_no_output`, and `failed`. The middle one matters: a run that
  correctly decided there was nothing to consolidate must advance the timestamp
  (it did its job), while a run that *failed* must not. Collapsing them means
  either re-running a healthy no-op every 10 minutes or suppressing retries after
  a genuine error. A sidecar file records which outcome last occurred.
- **Backoff, rather than a flat 24 h penalty for crashing.** The original text
  accepted "process dies mid-consolidation → no retry for `minHours`" as
  deliberate. codex instead sets `retry_at` with a backoff so a transient failure
  retries in minutes and a persistent one backs off toward the daily cadence
  anyway. Same protection against hot-looping, without punishing a one-off
  timeout with a lost day. `retryAt` joins the outcome in the sidecar file.

**Rate-limit guard.** codex checks the account's remaining quota before starting
background memory work (`guard.rs`, `min_rate_limit_remaining_percent`) and skips
if it is nearly spent — the user's own turns must not be starved by housekeeping.
We have no provider-agnostic quota signal, so this becomes a gate on what we *can*
see: skip consolidation if the current session has hit a provider rate-limit error
in this process's lifetime. Cheap, and it fails in the safe direction.

### D9 — One structured call over a deterministic input

The consolidator is **not** an agent with tools (§2). We assemble the input
ourselves, make one `provider.execute()` call on the provider's default (cheap)
model — the `extract.ts` / `title-generator.ts` shape — and apply the result
ourselves.

**Input** (assembled in code, hard-capped):

1. The full `MEMORY.md` index — names, types, descriptions. Cheap and complete.
2. **The workspace diff since the last successful consolidation** (D13) — what
   was added, changed, and deleted in the memory directory, as a git diff. This
   is the single most informative input and it costs one `git diff` to produce.
   Bounded at `MAX_DIFF_BYTES = 64 KB`; past that, the file list alone.
3. Bodies of up to `MAX_CANDIDATES = 20` memories, selected in this order:
   1. every memory touched by the diff,
   2. every episode over the D6 retention cap, least-used first,
   3. **duplicate suspects ranked by `usage_count`** — highest pairwise cosine
      among existing vectors, but among a tied cluster, prefer merging the ones
      that are actually being retrieved. **We already have every vector**, so
      "which memories are suspiciously similar" is a local computation, not
      something the model has to discover by reading files.
   4. memories unused for longer than `MAX_UNUSED_DAYS = 90` that have a
      plausible merge target — codex's `max_unused_days` window, which is the
      only mechanism in any of the references for retiring a *semantic* memory
      that nothing contradicts and nobody reads.

   Each body is annotated with `used: <n> times, last <date>` (D12) so the model
   is judging on evidence rather than on prose quality.
4. `title` + `lastTurnAt` of the sessions since the last consolidation.

The ordering matters: without usage data every one of these selectors is a
similarity proxy, and similarity answers "which of these look alike", not "which
of these is dead". That is why D12 is a prerequisite for D9 being better than a
coin flip, and why the phasing in §9 puts it first.

**Output** — one JSON object, strictly validated:

```jsonc
{
  "merges":  [{ "into": "<existing name>", "supersedes": ["<name>", ...],
                "description": "...", "content": "..." }],
  "episode": { "name": "...", "description": "...", "happened_at": "YYYY-MM-DD",
               "content": "..." } | null,
  "promote": [{ "type": "user|feedback|project|reference", "name": "...",
                "description": "...", "content": "..." }]
}
```

**There is no bare `delete`.** A memory can only be removed as the
`supersedes:` list of a merge — the model must name what replaces it. This is the
single most important safety property in the spec: an unconstrained delete verb
on a cheap model, running unattended against the user's memory, is the one
failure that is not recoverable from a retry. It also has a happy side effect:
**consolidation becomes the first writer ever to emit `supersedes:`**, so the
0.9-weight `Supersedes` edges that the graph has always supported finally exist.

mem0 is independent evidence for this call rather than against it: its v2 memory
manager offers the model ADD / UPDATE / DELETE / NONE over retrieved neighbours
(`configs/prompts.py:176`), and its v3 extraction prompt is **ADD-only**, with
relationships carried by `linked_memory_ids` instead. A library whose whole
product is memory management shipped a delete verb and then took it back.

With D13, the property gets a second layer that does not depend on the model
behaving: every consolidation is a git commit in a repository containing nothing
but memory, so a bad merge is one `git revert`.

Applied by us, with caps:

| Cap | Value | Why |
| --- | ----- | --- |
| `MAX_MERGES` | 5 | Bounds blast radius per run |
| `MAX_PROMOTES` | 3 | Same ceiling as extraction's `MAX_SAVES_PER_RUN` |
| Episodes | 1 | waku's contract exactly |
| `MAX_CANDIDATES` | 20 | Bounds input tokens (§6) |
| `MAX_DIFF_BYTES` | 64 KB | Same, for D13's diff; past it, send the file list only |
| Names in `supersedes` | must have appeared in the input | The model cannot delete something it was never shown |
| Secret filter | on every write | Unchanged from write-path D4 |

Failure of any kind — malformed JSON, dead provider, a name we did not send —
degrades to "consolidated nothing", rolls the lock back, leaves the D13 baseline
unmoved, and is invisible. Same discipline as `extract.ts`, which never throws.

### D10 — `MEMORY.md` needs no pruning phase

claude-code spends a whole dream phase pruning its index because the index is
hand-maintained *and* injected on every turn. Ours is neither: `updateIndex()`
regenerates it from the files on every save/delete (`mem-store.ts`), and it is
never injected (write-path D2). Merging N files into one shrinks the index
automatically, for free. Recorded here so a reader working from the `autoDream`
prompt does not port a phase we do not need.

### D11 — The user is told, on a wire that already exists

Nothing is ever recorded about the user silently. Consolidation reuses the
`memory.saved` bus event → `memory_saved` `StreamEvent`, with `verb: "Improved"`
— exactly claude-code's `createMemorySavedMessage(..., { verb: 'Improved' })`.
The bus speaker is subscribed at startup and writes regardless of whether a
stream is open (`server.ts:1080`, MEMORY_SYSTEM §7), which is required here:
consolidation finishes after the turn's `done`.

Message: *"Improved 3 memories and recorded 1 episode."* Same surface as the
existing *"Remembered 2 things for next time."*

### D12 — Memory citations: the loop that makes everything else measurable

Adopted from codex (`read/src/citations.rs`, `read/src/usage.rs`,
`state/migrations/0016_memory_usage.sql`), adapted to our injection model.

codex detects memory usage by watching the agent *read memory files* — it can,
because its memories are fetched on demand. Ours are auto-injected into the
system prompt, so there is no read to observe. The model must tell us instead.

**The contract.** `renderRetrievedMemories()` gains one closing line:

```
If any of the above shaped your answer, end your reply with:
<memory-used>type/name, type/name</memory-used>
```

The loop strips the tag from user-visible text (like any control marker) and
records the named ids. Malformed, unknown, or absent → recorded as no usage;
this never affects the reply.

**What is recorded.** Two counters per memory, in a sidecar
`<memoryDir>/.graph/usage.json`, keyed by `type/name`:

| Field | Meaning |
| --- | --- |
| `useCount` | Times cited |
| `lastUsedAt` | Epoch ms of the most recent citation |
| `injectedCount` | Times surfaced (from the existing `memory_injected` path) |

`injectedCount` is what makes the other two interpretable: `useCount` alone
cannot distinguish "never useful" from "never shown", and the ratio
`useCount / injectedCount` is a per-memory precision estimate — the closest thing
to ground truth this system will ever get for free.

**Why a sidecar and not frontmatter.** Writing a citation into the memory's own
file would bump `updatedAt`, dirty the D13 git baseline on every turn, and change
the content hash that gates re-embedding (`vector-store.ts`) — three separate
kinds of churn for a counter. `.graph/usage.json` is derived state that follows
the existing rule: **delete it and nothing breaks**, retention simply falls back
to age. It is written debounced, out of the hot path.

**Honesty about the signal.** Self-reported citation is not proof of use — a
model may credit a memory it ignored, or use one silently. It is a *biased but
directional* signal, and it is the only one obtainable without a second model
call. Treat `useCount` as evidence for ranking, never as grounds for deletion on
its own; D9 keeps requiring a merge target for anything to be removed.

### D13 — The memory directory is a git repository

Adopted from codex's Phase 2 essentially wholesale. `<memoryDir>/.git`, created
on first consolidation, with `.graph/` in `.gitignore` (derived state stays out).

- After each **successful** consolidation, commit the tree. That commit is the
  baseline.
- At the start of the next run, `git diff <baseline>..worktree` is exactly "every
  memory written since we last consolidated" — additions, edits, and deletions,
  with content, for free. It replaces the "assemble candidates and hope" step
  and it is strictly more informative than any heuristic selection.
- On failure, do not commit. The next run's diff then covers both windows, which
  is the same loss-safety property waku's unconsolidated-log flag provides and
  the write path's D5a already relies on.

**The forgetting rule comes free.** codex's prompt tells the agent that deletions
in the diff are authoritative: if an input file is gone, memory derived only from
it goes too, and a memory with both deleted and surviving support is *edited*, not
dropped. That rule needs the diff to exist; with it, forgetting is a consequence
of the mechanism rather than a separate feature.

**Two properties worth naming.** Consolidation becomes recoverable — a bad merge
is one `git revert` in a directory whose entire history is memory edits, which is
the strongest possible answer to §10.1's worry about unattended writes. And a
user hand-editing their own memory files shows up in the diff as an authored
change, so the consolidator sees and preserves it instead of silently reverting it
on the next merge.

**Cost and risk.** One `git init` and one commit per consolidation, at most daily,
in a directory of a few hundred small files. `git` is invoked as a subprocess
(same pattern as `context/tree-cache.ts`); no dependency is added. If `git` is
absent or the repo is corrupt, `consolidate.ts` degrades to D9's heuristic
candidate selection and logs once — the feature is an accelerant, not a
prerequisite. The memory directory is under `~/.freecode/projects/<key>/memory/`,
never inside the user's own repo, so there is no chance of nesting a git repo in
theirs.

### D14 — Recall is measured, not asserted

The gap §11 previously recorded as "principled, not measured" is closed here,
because D1 makes it untenable to leave open: a change to the retrieval scorer
that ships without a before/after number is a change nobody can defend.

**`memory/bench/` — an offline harness**, following jcode's
`memory_recall_bench.rs` in structure and agentmemory's in choice of dataset.

- **It runs the production primitives.** jcode's harness deliberately imports the
  real graph, the real embedder, and the real query-window builder rather than
  reimplementing scoring, because a benchmark of a reimplementation measures the
  reimplementation. Ours calls `MemoryGraphService.retrieve()` directly.
- **Three stages, cached between them** (jcode's shape): `queries` (replay
  sessions → per-turn query windows), `pool` (run retrievers → candidate pool),
  `metrics` (labels + pool → numbers). Staging matters because labelling is the
  expensive part and must survive re-running the retrievers.
- **Metrics:** recall@{5,10}, precision@5, MRR, nDCG@10 — plus **abstention
  accuracy**, the fraction of no-relevant-memory queries that correctly inject
  nothing. That last one is D1's floor, and LongMemEval includes abstention as
  one of its five abilities precisely because retrieval systems fail it.
- **Cost accounting per config** (jcode again): model calls and tokens are
  recorded alongside the metrics, so two designs are compared at equal cost
  rather than one being declared better for spending more. This is the number
  that decides the deferred LLM judge.
- **Corpora, two of them:**
  1. A committed synthetic fixture — ~40 memories, ~20 labelled queries, hand-
     written, in-repo, runs in CI on every change to retrieval. Fast and stable.
  2. **LongMemEval-S**, downloaded on demand to a path outside the repo,
     never committed. 500 questions across ~48 sessions each, and it uses
     `all-MiniLM-L6-v2` — **the same embedder FreeCode already runs** — so
     agentmemory's published numbers (95.2% R@5, 98.6% R@10 for BM25+vector) are
     a directly comparable external baseline rather than a vague target.
- **Privacy:** no real user sessions, ever. jcode keeps its corpus outside the
  repo under `~/jcode-memory-bench` for exactly this reason; we go further and
  use only synthetic and public data.

**Second, the runtime metric.** jcode's `memory_judge_metrics.rs` enumerates every
terminal outcome of a retrieval turn in one closed enum, tags each as intended or
degraded, and drives the degradation rate to zero — so a new code path that
surfaces memory cannot ship without declaring which kind of outcome it is. That
discipline is what defect 3 is a case of: a fallback firing silently for years
because nothing named it. `RetrievalOutcome` gets the same treatment —
`{ fused, vector_only, lexical_only, empty_by_floor, embedder_unavailable, error }` —
recorded on the existing rollout event stream, where `freecode trace` can already
read it.

## 5. Module layout

| File | Change | Responsibility |
| ---- | ------ | -------------- |
| **`memory/bm25.ts`** | **created** | D1: term-frequency index + BM25 scoring over the store |
| `memory/mem-query.ts` | modified | D1: `score()` delegates to BM25; `findRelevantMemories` returns ranks for fusion |
| `memory/graph/index.ts` | modified | D1: `seed()` fuses vector + BM25 ranks via RRF, floor on the fused score, terminal fallback removed; D2: plumb scores through `retrieve()`/`prepareMemories`; D6: decay multiplier on episode scores; D14: emit `RetrievalOutcome` |
| `memory/mem-prompt.ts` | modified | D2: `MAX_MEMORY_BLOCK_BYTES` + tiered degradation; D5: `## Episode` one-line section; D12: the `<memory-used>` instruction line |
| **`memory/usage-store.ts`** | **created** | D12: debounced read/write of `.graph/usage.json`, `recordInjected` / `recordCited` |
| **`memory/citations.ts`** | **created** | D12: parse and strip `<memory-used>` from assistant text |
| **`memory/git-baseline.ts`** | **created** | D13: `ensureRepo` / `diffSinceBaseline` / `commitBaseline`, all degrading to no-op |
| **`memory/bench/`** | **created** | D14: `queries.ts`, `pool.ts`, `metrics.ts`, `corpus/` fixture, `longmemeval.ts` loader |
| `session/manager.ts` | modified | D3: `endSession(sessionId, reason)` |
| `server.ts` | modified | D3: call it from `session.switch` / `.archive` / `.stop` / `.delete` and the `exit` handler |
| `memory/extract.ts` | modified | D4: `force` option |
| `memory/extract-policy.ts` | modified | D4: `force` bypasses gate 6 only; D7: consolidation settings alongside the extraction ones |
| `memory/mem-types.ts` | modified | D5: `"episode"` in the union + `MEMORY_TYPES`; `happened_at` parse/serialize |
| `tools/memory.ts` | modified | D5: reject `type: "episode"` on `save` |
| **`memory/consolidate.ts`** | **created** | D9: assemble input (index + D13 diff + usage-ranked candidates), one call, validate, apply under caps |
| **`memory/consolidate-policy.ts`** | **created** | D7: the five gates + settings |
| **`memory/consolidation-lock.ts`** | **created** | D8: read / acquire / rollback over one mtime, plus outcome + `retryAt` |
| `memory/graph/builder.ts` | modified | D5: `happened_at` onto the node so `/graph` can show it |
| `agent/loop.ts` | modified | D7: consolidation in the extraction slot, mutually exclusive; D12: strip `<memory-used>` and record citations against the injected set |
| `rollout/recorder.ts` | modified | D14: record `RetrievalOutcome` |
| `permission/mode-policy.ts` | **no change** | `memory` stays out of `READONLY_TOOLS` (write-path D7). Listed so the tool checklist shows it was considered |
| `docs/superpowers/MEMORY_SYSTEM.md` | modified | §2 layout, §3 write path, §10 gaps, §11 comparison |
| `apps/docs/app/internals/memory/page.mdx` | modified | Episodic + consolidation; its Known gaps shrink |

Each new file has one job and stays under the ~150-line limit. Consolidation does
**not** go into `extract.ts` — different trigger, different cadence, different
prompt, different failure mode.

## 6. Cost model

Stated plainly, because the intuition that this saves tokens is wrong.

**Added cost.** One cheap-model call per project per 24 h (and only if 5 sessions
happened). Input ≈ index (~500 tok) + ≤20 candidate bodies (~3 k tok) + session
titles (~200 tok); output ≤ ~800 tok. Under 4 k input tokens per day per active
project, on the cheap model. Extraction's cadence is unchanged.

**Saved cost.** D1 and D2 only, and they are real:

| | today | after |
| --- | --- | --- |
| Turn with no relevant memory | up to 8 full bodies, uncached | **nothing** |
| Turn with relevant memories | unbounded bytes | ≤ 2 KB, hard |
| One 4 KB memory in the top-8 | 4 KB every user message | ≤ 2 KB, degraded |

**Not saved: anything, by consolidation itself.** Merging three variants of a
fact into one does not shrink the injected block — the block was already capped
at 8 entries. What changes is that those 8 slots now carry 8 *distinct* facts
instead of 3 facts and 5 restatements. That is a **recall-quality** win at
constant token cost, and it should be evaluated as one. If it is sold internally
as a cost saving, the wrong knobs get tuned.

**And now it can be evaluated as one.** The previous paragraph was an assertion
when this spec was first written; with D14 it is a hypothesis with a test.
Concretely: build a corpus containing deliberate near-duplicates, measure
precision@5 before and after a consolidation pass, and report the delta. If it is
zero, D9 is not worth its complexity and should be cut — which is a conclusion
this spec should be willing to reach.

**Added cost from the new decisions.** D12: zero model calls; ~30 output tokens
per turn for the citation tag, and a debounced write to a small JSON file. D13:
one `git diff` and one commit per consolidation. D14: nothing at runtime — it is
a development tool, and only the synthetic corpus runs in CI.

## 7. Failure modes

| Failure | Behaviour |
| --- | --- |
| Consolidator returns malformed JSON | Nothing applied; lock rolled back; next attempt after the scan throttle |
| Consolidator names an unknown memory in `supersedes` | That merge is dropped; siblings still apply |
| Consolidator proposes 20 merges | First 5 applied, rest dropped (D9) |
| A merge's content contains a secret | Refused by `containsSecret()`; the superseded originals are **not** deleted |
| Two processes consolidate the same project | Second `tryAcquireConsolidationLock()` returns `null`; it returns immediately |
| Process dies mid-consolidation | Lock mtime is already advanced → no retry for `minHours`. Deliberate: a crashing consolidator must not loop |
| Embedder unavailable | D6's duplicate-suspect heuristic has no vectors → candidate set is episodes-over-cap only. Consolidation still runs, on less signal |
| Episode count exceeds the cap and consolidation never fires | Retrieval decay (D6.1) still demotes them; the cap is enforced only by consolidation, so the store grows slowly rather than being wrong |
| `endSession` called twice for one id | Idempotent; flush runs once (D3) |
| D1 makes retrieval return nothing where it used to return something | Intended for genuine misses; **D14 decides whether it is right**. The knobs are the fused floor and `RRF_K`, measured — not argued |
| BM25 index stale after a save | Rebuilt in the same `sync()` pass as the embeddings, off the same entry list; a stale index degrades ranking, never correctness |
| Model never emits `<memory-used>` | All `useCount`s stay 0; D9 falls back to cosine-only candidate selection and D6 to pure age decay. Degrades to exactly the pre-D12 behaviour |
| Model cites a memory that was never injected | Ignored — the recorded set is the intersection with what we actually surfaced |
| `<memory-used>` leaks into user-visible text | Stripping is a loop-level responsibility with a test; a leak is cosmetic, never a data error |
| `.graph/usage.json` deleted or corrupt | Treated as all-zero. Retention falls back to age; nothing throws |
| `git` missing, or the memory repo is corrupt | `git-baseline.ts` returns "no diff available"; D9 uses heuristic candidate selection. Logged once per process, never per run |
| Consolidation succeeds but the baseline commit fails | Next run's diff spans two windows — a superset, so nothing is missed. Same loss-safety as a failed run |
| User hand-edits a memory file | Appears in the diff as an authored change; the consolidator is told changes in the diff are authoritative (D13) and preserves it |
| LongMemEval fixture not downloaded | The synthetic corpus still runs; the LongMemEval stage skips with a message. CI never depends on a network fetch |

## 8. Testing

`node:test`, matching `memory/*.test.ts` — temp dir, real `MemoryStore`, no
mocking of the store.

- `memory/bm25.test.ts` — IDF demotes a term present in every memory; length
  normalization stops a long memory from outranking a precise short one on the
  same query (the specific defect in today's scorer); an empty corpus and a
  single-document corpus both score without dividing by zero.
- `memory/graph/fusion.test.ts` — RRF ranks a document found by both retrievers
  above one found by either alone; fusion is invariant to the two retrievers'
  score *scales* (multiply all cosines by 100, get the same order) — the
  property that motivated choosing RRF.
- `memory/graph/retrieval-floor.test.ts` — with a live embedder and a query
  matching nothing, `prepareMemories` returns `[]`; with the embedder marked
  unavailable, the same query still returns lexical hits; `memory.query` is
  unaffected by the floor.
- `memory/mem-prompt.test.ts` (extend) — a 10 KB memory renders under 2 KB;
  degradation is by score order; episodes always render as one line; the
  *guidance* block stays byte-identical regardless of store contents (the
  existing property D2 of the write path depends on).
- `memory/consolidate.test.ts` — merge writes `supersedes:` and deletes the
  named originals; a `supersedes` name never sent is dropped while siblings
  apply; caps hold at 5/3/1; a secret-bearing merge writes nothing **and**
  deletes nothing; malformed and throwing completions apply nothing and do not
  reject; episodes over the cap are deleted only after a successful call.
- `memory/consolidate-policy.test.ts` — time gate blocks before `minHours`;
  session gate counts only this project, excludes the current session, and skips
  `turnCount < 2`; scan throttle suppresses repeat scans; both kill switches
  work; an unparseable settings file falls through to defaults rather than
  disabling memory.
- `memory/consolidation-lock.test.ts` — acquire returns the prior mtime and
  advances it; a second concurrent acquire returns `null`; rollback restores.
- `memory/extract-policy.test.ts` (extend) — `force` bypasses the interval and
  **nothing else**: each kill switch and the too-short gate still block a forced
  flush.
- `session/manager.test.ts` (extend) — `endSession` runs all six disposers and is
  idempotent; each of switch / archive / stop / delete reaches it.
- `memory/citations.test.ts` — a well-formed tag parses and is stripped from the
  visible text; malformed, empty, and absent tags yield no usage and no error; a
  cited name that was never injected is discarded; the tag is stripped even when
  the model wraps it in a code fence.
- `memory/usage-store.test.ts` — counters survive a round trip; a deleted or
  truncated `usage.json` reads as all-zero; concurrent writes from two sessions
  do not lose an increment.
- `memory/git-baseline.test.ts` — a diff after edits lists exactly the changed
  files; a failed consolidation leaves the baseline unmoved so the next diff
  spans both windows; with `git` unavailable every function returns the
  degraded value and nothing throws.
- `memory/bench/metrics.test.ts` — recall@k, MRR, and nDCG match hand-computed
  values on a five-document fixture; abstention accuracy counts a correctly
  empty result as a success and an injected-anyway result as a failure.
- Round-trip that the write path never got (its §8 open item): save → episode →
  `retrieve()` returns it, and a 400-day-old episode ranks below a same-week one
  for the same query — and, with D12 data present, a heavily-used 400-day-old
  episode ranks *above* an unused same-month one.

## 9. Phasing

Each phase ships alone and is useful alone. The ordering changed with D12–D14:
measurement now comes before the change it measures, and the usage loop before
the decisions that read it. (These are *our* phases; codex's "Phase 1 / Phase 2"
elsewhere in this document are its own pipeline stages and unrelated.)

- [ ] **Phase 0 — the ruler.** D14's harness plus the synthetic corpus. No
      product change at all; it only reports numbers about today's retrieval.
      Small, and it makes every later phase arguable on evidence. Ends with a
      committed baseline for today's behaviour.
- [ ] **Phase 1 — retrieval quality.** D1 (BM25 + RRF + fused floor) and D2
      (byte cap, score plumbing). No model calls, no schema change. **Ships only
      with a Phase 0 before/after in the PR description**, including abstention
      accuracy. This is where the token savings are.
- [ ] **Phase 2 — the usage loop.** D12. One prompt line, one sidecar file, one
      parser. Independently valuable — `useCount / injectedCount` per memory is
      the first real read on whether any of this works — and a prerequisite for
      Phases 4 and 5 being better than guesswork. Let it accumulate data while
      the next phase is built.
- [ ] **Phase 3 — session end.** D3, D4. A session-lifecycle fix that also closes
      MEMORY_SYSTEM §10 gap 1 and unblocks Phase 5's session gate.
- [ ] **Phase 4 — episodes.** D5, D6. The type, the use-discounted decay, the
      cap, the rendering. Written only by Phase 3's flush until Phase 5 lands.
- [ ] **Phase 5 — consolidation.** D7–D11, D13. The merge/prune pass, reading
      the git diff and the usage counters gathered since Phase 2.

**If only two phases are ever built, build 0 and 1.** They fix live defects, cost
nothing to run, and are the only parts whose value does not depend on the rest.

## 10. Decisions taken without explicit sign-off

Recorded so they are easy to overturn:

1. **No bare delete verb** (D9). The strongest safety property here, and the most
   likely thing to be argued with when a genuinely obsolete memory has no
   successor to merge into.
2. **Episodes are machine-written only** (D5). If the model should be able to log
   a decision deliberately, that is one line in the tool's validator.
3. **Consolidation is one call, not an agent** (D9) — diverges from `autoDream`
   for the same structural reason write-path D6 did. Revisit if `SubagentType`
   ever grows a tool allowlist.
4. **Consolidation and extraction are mutually exclusive per completion** (D7).
   Conservative; the alternative is two provider calls in one turn-end.
5. **New tuning guesses,** joining the existing set (TODO.md: cap 3, interval 8,
   200-char minimum, seed threshold 0.4, decay 0.7): `minHours 24`,
   `minSessions 5`, `MAX_EPISODES 50`, `EPISODE_HALF_LIFE_DAYS 30`,
   `MAX_CANDIDATES 20`, `MAX_MEMORY_BLOCK_BYTES 2048`, `MAX_DIFF_BYTES 64 KB`,
   `MAX_UNUSED_DAYS 90`, `RRF_K 60`, BM25 `k1 1.2` / `b 0.75`, merge/promote caps
   5/3. `minHours`/`minSessions` are claude-code's production defaults;
   `MAX_UNUSED_DAYS` is codex's; `RRF_K = 60` and the BM25 pair are the standard
   literature values. **The retrieval-side constants are no longer permanent
   guesses** — D14 can sweep `RRF_K`, the fused floor, and
   `EPISODE_HALF_LIFE_DAYS` and report which value wins. The consolidation-side
   ones remain unmeasured.
6. **`.graph/` holds the lock** (D8) and the usage counters (D12), so deleting
   the sidecar resets the consolidation schedule and the usage history. Judged
   correct for the lock — schedule is derived state. **Less obviously correct for
   usage**, which is accumulated evidence that cannot be recomputed from the
   files; the alternative is a durable location outside `.graph/`, at the cost of
   a second thing to keep consistent. Taken as-is because "delete `.graph/` and
   nothing breaks" is the invariant the whole system rests on, and losing
   retention data degrades gracefully to age-based behaviour.
7. **Citations are self-reported and trusted** (D12). The model says which memory
   it used and we believe it. The alternative — a judge model comparing reply to
   injected set — costs a call per turn to measure something we only use for
   ranking. Mitigated by never letting `useCount` alone delete anything.
8. **The memory directory becomes a git repository** (D13). It is under
   `~/.freecode/projects/`, never inside a user's own repo, and `.graph/` is
   ignored — but it is still a new on-disk structure the user did not ask for,
   and `freecode memory` commands now operate inside a repo. Reversible: delete
   `.git` and consolidation degrades to heuristic selection.
9. **The LLM retrieval judge is deferred, not rejected** (§2). The condition for
   revisiting is explicit: once D14 reports a baseline. Recorded because the
   original spec declined it outright and jcode is good evidence against that.

## 11. Dependencies and known gaps

**Hard prerequisites.** D3 (session end) blocks Phases 4 and 5. D14's harness
should precede D1, since D1 changes retrieval for every turn and needs a
before/after. D12 should precede D6's decay and D9's candidate selection, which
both read `useCount` — neither is *blocked* (each degrades to the age- and
cosine-only behaviour originally specified), but both are guesswork without it,
which is the reason Phase 2 sits where it does.

**Should land first, not blocking:** the memory project-key collision
(`mem-store.ts:31` keys on `path.basename()`; TODO.md). It is tolerable for
"user prefers tables" and actively wrong for episodes, which are the most
project-specific thing the store will ever hold. `store/path-formatter.ts`
already solves it for sessions with a full reversible path — reuse it, plus a
rename migration for existing `~/.freecode/projects/`.

**Left open:**

1. **`Contradicts` edges are still never produced.** Consolidation emits
   `Supersedes` (the writer-knows case). Detecting that two independently-written
   memories disagree needs pairwise reasoning this spec does not do.
2. **`VectorStore` is O(n²) on full sync** and rewrites every vector per save
   (TODO.md). D9's pairwise-cosine candidate selection makes it matter sooner.
   Add the id→index `Map` before Phase 5.
3. ~~No evaluation harness for recall quality.~~ **Closed by D14** — with the
   caveat that a harness only measures what its corpus contains. The synthetic
   fixture is written by the same people who wrote the retriever, which is a real
   bias; LongMemEval-S exists in the plan specifically to provide a corpus nobody
   here authored.
4. **Retention is enforced only by consolidation.** If consolidation never fires,
   episodes accumulate — demoted by decay, but never deleted.
5. **Progressive disclosure is the successor to D2.** codex replaces the
   injected-block problem with a navigational index plus on-demand fetch through
   a read-only memory-fs MCP server (`memories/mcp/`), so a long memory is never
   truncated, only not-yet-read. That is the better design and D2 is the cheap
   version of it. Deliberately out of scope: it is a read-path redesign that
   touches the MCP surface and prompt caching. Revisit if D14 shows the byte cap
   is costing recall.
6. **Codex's Phase 1 mines finished rollouts; we still only mine live
   transcripts.** D4's end-of-session flush narrows the gap — a session that ends
   at run 5 now extracts — but the 390 historical rollout directories under
   `~/.freecode/rollout/sessions/` remain unmined, and nothing in this spec ever
   goes back for them. Codex's answer is a bounded, leased, parallel backfill at
   startup. Ours would be simpler (one project, serial), but it is a phase of its
   own and is not planned here.
7. **Usage data has no cross-device story.** `.graph/usage.json` is local, so a
   user on two machines splits their evidence. Consistent with everything else in
   memory today (the store is per-machine), noted because D12 is the first part
   of the system where the *history* matters rather than just the current state.
