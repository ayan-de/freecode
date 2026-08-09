# Memory Write Path

> **Date:** 2026-08-09
> **Status:** ✅ Implemented (2026-08-09) — both phases live, on `feat/memory-write-path`.
> One deviation from D6, recorded in place below.
> **Extends:** `specs/2026-07-26-memory-knowledge-graph.md` (the read side — implemented)
> **Related:** `specs/2026-06-02-memory-session-design.md`, `specs/2026-08-09-cache-observability.md` (D2 cache-bust attribution)
> **Prior art studied:** `claude-code` (`memdir/`, `services/extractMemories/`, `services/autoDream/`)
> and `jcode` (`crates/jcode-base/src/memory_agent.rs`, `memory.rs`), both read at their
> working trees on 2026-08-09.
> **Companion plan:** `docs/superpowers/plans/2026-08-09-memory-write-path.md` (to be written)

---

## 1. Problem

The memory knowledge graph is fully implemented on the read side and retrieves
from an empty directory.

Nothing in FreeCode ever creates a memory:

1. **No tool.** `apps/core/src/tools/` has no `memory` tool. The model has no
   affordance to save anything.
2. **No prompt.** `buildMemoryPrompt` (`memory/mem-prompt.ts:22`) — the block that
   would tell the model memory exists — is reachable only through the
   `memory.buildPrompt` IPC method (`server.ts:870`). It is never injected into
   the agent loop's system prompt. The model is not aware the subsystem exists.
3. **No caller.** The `memory.save` IPC handler (`server.ts:793`) exists, but a
   grep across `apps/tui`, `apps/vscode`, and `apps/web` returns zero callers of
   any `memory.*` method. No frontend surface writes a memory either.
4. **No extraction.** Nothing inspects a finished turn for durable facts.

The store's own generated index already documents a tool that was never built —
`mem-store.ts:195` writes the line *"Use the memory tool to add, update, or
remove memories."*

Observable consequence: `~/.freecode/projects/` contains 114 directories, every
one of them a test fixture (`gex-api-*`, `kg-p*`). There is no memory directory
for this project or any other real one. Every turn runs `prepareMemories()`
(`agent/loop.ts:1140`), walks a graph with zero nodes, and injects nothing.

**This spec covers the write side only.** Retrieval, embedding, graph
construction, cascade, and clustering are implemented and unchanged.

## 2. Prior art

|                                   | freecode (today) | claude-code                    | jcode                          |
| --------------------------------- | ---------------- | ------------------------------ | ------------------------------ |
| Model can save a memory           | ✗                | ✅ ordinary Write tool         | ✅ memory-agent tools          |
| Told in system prompt it has memory | ✗              | ✅ always                      | ✅ `memory_prompt.rs`          |
| Auto-extraction from transcript   | ✗                | ✅ end of every query loop     | ✅ topic change + periodic + session end |
| Background consolidation          | ✗                | ✅ `autoDream`, time-gated     | ✅ ambient mode                |
| Secret filtering on **write**     | ✗                | —                              | ✅                             |
| Retrieval                         | ✅ vectors + graph cascade | LLM picks ≤5 from a header manifest | vectors + graph + LLM rerank |

FreeCode has the strongest retrieval of the three and the only absent write path.

**What we take from claude-code.** Its extractor
(`services/extractMemories/extractMemories.ts:5`) runs *"once at the end of each
complete query loop (when the model produces a final response with no tool
calls)"* as a forked agent that shares the parent's prompt cache, restricted to
read tools plus write access confined to the memory directory. That shape maps
onto machinery FreeCode already has (`agent/subagent.ts`, permission profiles,
the natural completion branch at `agent/loop.ts:846`).

**What we decline from jcode.** A separate always-running Haiku agent
(`memory_agent.rs`, 1,901 lines) with its own channel, trust levels, and a
620-line LLM reranker. That is ~4,800 lines of subsystem to buy capture quality
we have no way to evaluate until memories exist. Revisit once the store is
populated and we can measure.

## 3. Goals

- **The store gets populated** — by the model during a turn, and by an extractor
  after it, without the user having to do anything.
- **Every write goes through `MemoryStore`** so frontmatter, the `MEMORY.md`
  index, and the derived graph stay consistent by construction.
- **Zero steady-state token cost** for users who never accumulate memories, and
  no disturbance to the cached system-prompt prefix.
- **Never break the loop.** A memory failure is invisible to the user's task.

### Non-goals

- Background consolidation / distillation (claude-code's `autoDream`, jcode's
  ambient mode). Nothing to consolidate until the store fills up.
- Trust levels, LLM reranking, contradiction resolution (jcode).
- Cross-project or global memory scope. Per-project only, as today.
- Any change to retrieval, embedding, the graph, or `/graph`.
- A TUI surface for browsing/editing memories. `/graph` already views them.

## 4. Key design decisions

### D1 — A `memory` tool, not raw `write`

claude-code instructs the model to write memory files with the ordinary Write
tool (`memdir/memdir.ts:117`) because it has no store abstraction. FreeCode has
one, and bypassing it loses three things at once:

| via `MemoryStore.save()` (`mem-store.ts:112`) | via raw `write` |
| --- | --- |
| Valid frontmatter, serialized from a typed `MemoryEntry` | model hand-writes YAML; a typo silently degrades the entry |
| `updateIndex()` refreshes `MEMORY.md` | index goes stale |
| `emitMemoryChange()` → incremental embed + graph edges | no event; index only self-heals on the next full `sync()` |

So: a `memory` tool wrapping the store. Actions `save`, `delete`, `list`.

`list` returns names + descriptions + types only, never bodies — it is the
model's dedup check before saving, not a bulk-recall path (recall is what the
graph is for).

### D2 — Guidance is static and cached; the index is **not** injected

The system prompt is assembled from a cached static prefix (`systemBlocks`, from
`compileSystemBlocks`) plus uncached session blocks (`agent/loop.ts:1165-1171`).
Where the memory guidance lands determines its cost.

The guidance text — what memory is, the four types, what not to save, when to
save — is **constant**, so it goes in the static prefix and is paid for once per
session at cache-creation, then read at ~10% rate forever after.

The `MEMORY.md` index is **not** injected at all. This is a deliberate departure
from claude-code, which loads MEMORY.md into context on every turn and
consequently needs caps (`MAX_ENTRYPOINT_LINES = 200`,
`MAX_ENTRYPOINT_BYTES = 25_000`) to stop it dominating the prompt. Injecting it
would also mutate the static prefix on every save, busting the cache for the
whole session — a real cost, since one save invalidates the entire cached
prefix, not just the index block.

FreeCode does not need it: semantic retrieval already surfaces *relevant*
memories per turn (`renderRetrievedMemories`), and the only other job the index
does — telling the model what already exists so it doesn't create
`api-style-2` — is served on demand by `memory(action: "list")`.

Net: users with no memories pay the guidance block only (~150 tokens, cached);
users with 500 memories pay the same.

### D3 — `save` is idempotent on name, and says what it did

`MemoryStore.save()` overwrites by `(type, name)`. The tool returns which
happened — `created` vs `updated`, and for an update, the previous description —
so the model can tell whether it just clobbered something it didn't intend to.
This is the cheap version of contradiction detection; the `supersedes`
frontmatter field (already parsed at `mem-types.ts:101`, currently unused by any
writer) is how the model expresses a deliberate replacement of a *differently
named* memory.

### D4 — Secrets are refused at write time, not just at embed time

`graph/secret-filter.ts`'s `containsSecret()` is currently consulted only by
`graph/index.ts` before embedding (lines 152, 211). A secret-bearing memory is
therefore never *vectorized* — but it is still *written to disk in plaintext*
and still injected via the keyword fallback path.

The `memory` tool runs `containsSecret()` on `description + content` and refuses
the save with an explanatory error. Cheap, reuses an existing tested function,
and closes a hole that exists today independently of this feature.

### D5 — Extraction runs at natural completion, capped and non-blocking

Trigger: `agent/loop.ts:846`, `return this.complete("Done", ...)` — the branch
reached when the model emits a final response with no tool calls, after the
verifier gate. This is the exact analogue of claude-code's trigger.

Deliberately **not** the `Stop` hook: `runStop` (`loop.ts:2211`) fires only on
abnormal termination — `max_iterations_reached`, loop-health stop,
`spend_budget_exceeded` — not on normal completion. And **not** `TurnEnd`
(`loop.ts:665`), which fires after *every* inner turn including tool-call turns,
so extraction would run many times per user request.

Properties:

- **Fire-and-forget.** The loop returns its `LoopResult` immediately; extraction
  runs detached. The user never waits on it. Same discipline as
  `void graph.onChange(entry)` (KG spec D2).
- **Capped at 3 saves per completion.** A runaway extractor that saves a memory
  per turn fills the store with noise faster than any consolidation could clean
  it, and there is no consolidation (§3 non-goals).
- **Skipped when there is nothing to learn** — no user message this run, or the
  run was interrupted/failed.
- **Errors swallowed.** A failed extraction logs at debug level and is otherwise
  invisible.

### D6 — Extraction is a one-shot provider call ⚠️ *(revised during implementation)*

**As specified:** `executeSubagent` (`agent/subagent.ts:42`) allowed the `memory`
tool only.

**As built:** a single `provider.execute()` call returning a JSON array of
proposals, which `extract.ts` validates and saves itself — the
`agent/title-generator.ts` pattern, and the same shape as jcode's
`Sidecar::extract_memories`, which likewise returns structs for the caller to
persist.

The spec was wrong on a fact: `SubagentType` (`agent/types.ts:38`) is a closed
union of five types and `SubagentConfig` carries no tool allowlist, so
"allowed the `memory` tool only" is not expressible through `executeSubagent`
without adding a sixth subagent type. Weighed against that, the one-shot call
is strictly better here: one request instead of an agent loop, and because *we*
parse the proposals rather than letting a model call a tool, the
`MAX_SAVES_PER_RUN` cap is enforced deterministically instead of being a request
the model may ignore.

`profiles.ts:263` still gains `memory: ["file.write"]` — the tool is real and
reachable by any agent, and without the entry `isToolAllowed` fails closed on
the unknown-tool branch (`profiles.ts:285`).

**Subagents do not extract.** `executeSubagent` passes `memoryExtraction: false`
(new `AgentLoopConfig` field, default `true`). Not in the original spec, and a
real defect it would have shipped: `executeSubagent` calls `loop.run()`, so every
verifier / explorer / reviewer would have fired its own extraction call against a
transcript of delegated machine work, turning one user turn into several
extraction calls.

**Cost.** Extraction adds **one provider call per completed top-level run**.
No model is passed, so the provider's default (cheaper) model handles it rather
than the session's main model. claude-code pays this too but softens it by
forking the parent agent to share its prompt cache; FreeCode has no forked-agent
primitive, so ours is a fresh call over a transcript clipped to 12k chars.

### D7 — `memory` is a mutating tool

It is **not** added to `READONLY_TOOLS` (`permission/mode-policy.ts:15`), so it
is blocked in `plan`, `review`, and `explore` modes, consistent with every other
tool that writes to disk.

Accepted tradeoff: a preference the user states during a planning session is not
captured. Failing closed matches the house rule in `CLAUDE.md`'s tool checklist
("unlisted ⇒ treated as mutating ⇒ blocked in plan/review/explore"), and the
extraction subagent (D6) runs on its own profile, so it is unaffected by the
parent's mode.

## 5. Module layout

| | File | Change | Responsibility |
| --- | --- | --- | --- |
| ✅ | `tools/memory.ts` | **created** | The tool: `save` / `delete` / `list` over `MemoryStore`, secret check (D4) |
| ✅ | `memory/mem-prompt.ts` | modified | `buildMemoryGuidanceBlock()` — static text, no entries (D2) |
| ✅ | `memory/extract.ts` | **created** | `extractMemories(input)` — one-shot call, parse, cap, error swallowing (D5/D6) |
| ✅ | `tools/index.ts` | modified | Registered the tool |
| ✅ | `permission/mode-policy.ts` | **no change** | Deliberate omission from `READONLY_TOOLS` (D7). Listed so a reviewer working the tool checklist sees it was considered, not forgotten |
| ✅ | `permission/rules.ts` | **no change** | Deliberate omission from `PATH_TOOLS`/`URL_TOOLS` — the tool takes no path or url argument, so path-scoped rules have nothing to match |
| ✅ | `permission/suggest.ts` | modified | `DISPLAY_NAMES["memory"] = "Memory"` |
| ✅ | `permission/profiles.ts` | modified | `TOOL_PERMISSIONS.memory = ["file.write"]` (D6) |
| ✅ | `context/compiler.ts` | modified | Guidance block emitted into the cached static prefix (D2) |
| ✅ | `agent/loop.ts` | modified | `kickMemoryExtraction()` at the `complete("Done", …)` branch; `memoryExtraction` config field (D5) |
| ✅ | `agent/subagent.ts` | modified | Passes `memoryExtraction: false` (D6) |

`tools/memory.ts` stays under the ~150-line project limit; extraction lives in
`memory/extract.ts` rather than in the tool, so the tool has one job.

## 6. Phasing

- [x] **Phase 1 — model-driven.** D1–D4, D7. The tool, the guidance block, the
  registration tables. Self-contained: the store starts filling from the model's
  own judgement, and every downstream consumer (graph, `/graph`, retrieval)
  becomes exercised for the first time.
- [x] **Phase 2 — the safety net.** D5, D6. Extraction at completion.

Phase 1 ships and is useful alone. Phase 2 is what makes capture reliable rather
than dependent on the model remembering to act.

## 7. Failure modes

| Failure | Behaviour |
| --- | --- |
| Tool called with an invalid `type` | `validateInput` rejects with the four valid values echoed back |
| Tool called with a name that collides | Overwrites; result reports `updated` + the prior description (D3) |
| Content contains a secret | Refused with an explanation; nothing written (D4) |
| `MemoryStore.save()` throws (disk full, permissions) | Tool returns `success: false` with the message; loop continues |
| Extraction subagent errors or times out | Swallowed; turn already returned (D5) |
| Extraction proposes 10 memories | First 3 saved, rest dropped (D5) |
| Embedder unavailable | Irrelevant to writes — `save` never embeds inline; `onMemoryChange` handles it, already non-throwing |

## 8. Testing

`node:test`, matching the existing convention in `memory/*.test.ts` and
`memory/graph/*.test.ts` (temp dir + real `MemoryStore`, no mocking of the store).
**18 new tests; suite green at 520/520.**

- [x] `tools/memory.test.ts` (8) — save creates a file whose frontmatter
  `parseMemoryFrontmatter` round-trips; save on an existing name reports
  `updated` with the prior description; delete reports hit vs miss; list returns
  descriptions but never bodies; a secret-bearing save is refused and writes
  nothing; `validateInput` rejects a bad type and missing per-action fields;
  comma-separated `tags` from strict-decoding providers are coerced.
- [x] `memory/extract.test.ts` (7) — the 3-save cap holds when 5 are proposed;
  a throwing completion saves nothing and does not reject; malformed output
  saves nothing; an empty transcript never calls the provider; a secret-bearing
  proposal is skipped while its siblings save; fenced JSON parses; proposals
  with an unknown type or missing fields are skipped.
- [x] `memory/mem-prompt.test.ts` (3) — the guidance block is byte-identical
  across calls with different store contents (the property D2's caching depends
  on), names the tool/types/exclusions, and stays small.
- [x] Regression guard for `memoryExtraction: false` — `recovery/manager.test.ts`
  asserts an exact provider-call count, so a broken flag turns 3 into 4 and fails.
- [ ] **Not done:** the integration test (save via tool →
  `MemoryGraphService.retrieve()` returns it). The retrieval half is already
  covered by the graph suite; this would prove the change event links the two
  end to end.

## 9. Success criteria

- [x] The static system-prompt prefix is byte-identical before and after a memory
  save, so `cacheHitRate` is unchanged by memory activity (D2). *Verified by
  test:* the guidance block — the only memory text in the cached prefix — is
  constant by construction.
- [x] A memory containing an API key is never written to disk (D4). *Verified by
  test,* on both the tool and the extraction path.
- [x] No path through the tool or the extractor can throw into `AgentLoop.run()`.
  *Verified by test* for the extractor (throwing and malformed completions);
  the tool returns failures as tool results, never exceptions.
- [ ] A fresh project accumulates memories through ordinary use, with no user
  action. **Not yet verified — needs a real session against a live provider.**
- [ ] `freecode memory graph stats` reports non-zero `nodes` on a real project.
  **Not yet verified,** same reason.
- [ ] Turn latency at completion unchanged within noise (D5). **Not measured;**
  true by construction (the promise is never awaited) but unbenchmarked.

## 10. Decisions taken without explicit sign-off

Recorded so they are easy to overturn:

1. **Index not injected** (D2) — diverges from claude-code. If dedup turns out to
   be poor in practice, the cheaper fix is improving `list`, not injecting.
2. **`memory` blocked in plan mode** (D7) — fail-closed. Reversible by one line
   in `READONLY_TOOLS`, but that would let a "read-only" mode write to disk.
3. **3-save cap** (D5) — arbitrary, chosen to bound noise. Should be revisited
   with real data.
4. **No consolidation** (§3) — both reference implementations have it; we defer
   until there is something to consolidate.
5. **Extraction is always on** (D6) — one extra provider call per completed
   top-level run, on the provider's default model. No setting gates it. If the
   cost shows up in `/cost` before the memories show their worth, the
   `memoryExtraction` config field is already the switch; it just needs to be
   surfaced through settings.
