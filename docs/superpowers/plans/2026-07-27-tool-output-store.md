# Plan: Tool-Output Store & Adaptive Truncation

> **Date:** 2026-07-27
> **Spec:** `docs/superpowers/specs/2026-07-27-tool-output-store.md`
> **Status:** Implemented (2026-07-27) — Phases 1–3 shipped in
> `apps/core/src/tools/output-store/` + `tools/output.ts`. (Phase 3.3 store-stats
> IPC intentionally skipped — `OutputStore.stats()` exists but wiring new IPC
> wasn't warranted; revisit if a maintenance surface is needed.)
> **Scope (locked):** Per-session in-memory store of full tool output + a retrieval
> tool + head/tail adaptive truncation. No disk persistence, no embeddings.

Each phase is independently shippable and leaves the loop working (D4 degradation).
Files target ~150 lines (project rule). Verify criteria before advancing.
No new dependencies — the full output already exists as `result.displayOutput`.

---

## Phase 1 — Store + adaptive truncation (the token win, no new tool yet)

Delivers head+tail truncation and full-output capture immediately; retrieval lands
in Phase 2. Even alone this is a win: the model stops losing the *tail*.

1. `tools/output-store/store.ts` — `OutputStore` is a **session-scoped instance**
   (one per session): `Map<toolCallId, string>`, `put(id, text)` /
   `get(id)` / `slice(id, offset, limit)` / `grep(id, pattern)` / `dispose()`,
   byte-LRU eviction (default 16 MB/session, configurable). No `sessionId` arg on any
   method — the instance *is* the session's store.
2. `tools/output-store/truncate.ts` — `adaptiveTruncate(text, toolCallId)` →
   `{ modelOutput, truncated }`, keeping HEAD (22k) + TAIL (6k) with a marker that
   names the id and the `output` retrieval handle. Replaces `capModelOutput`.
3. `tools/output-store/index.ts` — `getOutputStore(sessionId)` returns that
   session's `OutputStore` instance; `disposeOutputStore(sessionId)`. Factory holds
   a session LRU (default **50 concurrent sessions**, evict + `dispose()` oldest).
4. `tools/orchestrator.ts` — read `ctx.sessionId` (already threaded — no change to
   `ToolContext`); `getOutputStore(ctx.sessionId).put(call.id, displayOutput)`; swap
   `capModelOutput` → `adaptiveTruncate`. **Delete the dead `mapToolResult` (lines
   102–126)** — it's a stale duplicate of the live inline truncation in `execute`
   (lines 268–303); leaving it creates a second truncation path that will diverge.
5. `server.ts` — `disposeOutputStore(sessionId)` beside `disposeSessionMemory` on
   `session.delete` only (line 599); `session.archive` intentionally keeps the store.

**Verify:** an output > cap now shows head **and** tail to the model; full text is
in the store (`store.get(id)` returns all of it); loop unchanged when nothing
overflows; `grep -c capModelOutput orchestrator.ts` == 0 (no stale path left).

---

## Phase 2 — `output` retrieval tool

Turns the stored full output into something the model can page through.

1. `tools/output.ts` — `buildTool`: params `id` (string, required),
   `offset`/`limit` (number, coerced — MiniMax sends strings), `pattern` (string,
   optional). `execute` → `store.slice` / `store.grep`; unknown id → D4 message.
   Declare `type` on every schema property. **Reuse the existing coercion, don't
   write a third copy:** `coerceNumber` already exists (private at `read.ts:76`).
   Export it from `read.ts` — or lift it into a shared `tools/utils.ts` — and import
   it here. (`grep.ts` coerces its own `-C/-A/-B` too; fold that onto the same shared
   helper if it has a private copy.)
2. `tools/output/ui.ts` — `ToolUI` renderer (reuse Read/Bash-style content render).
3. `tools/index.ts` — import + add `output` to the tools map.
4. `permission/mode-policy.ts` — add `output` to `READONLY_TOOLS`.
5. `permission/suggest.ts` — add `output` to `DISPLAY_NAMES` ("Output").
6. `tools/factory.ts` — add `output` to `defaultToolUI.renderToolUseTag`'s color map
   (else the TUI tag renders with the fallback white).
7. Cap `output`'s own result via `adaptiveTruncate` so paging can't re-overflow.

**Verify:** truncate a large `bash`/`grep` output, then `output(id, offset=…)`
returns the tail **without** re-running the tool; `output` on a bogus id returns the
degradation message (not an error); a huge slice is itself capped and re-pageable;
`output` is permitted in plan/review/explore modes.

---

## Phase 3 — Limits, config & polish

1. Make byte caps configurable: per-session store bytes, HEAD/TAIL split,
   per-`output`-call max lines. **No generic `config.get` exists** in this codebase
   (only `providers/config.ts`, `mcp/config.ts`, and `cli/utils/config.ts`'s
   `getConfigDir()` path helper). Pick the mechanism first: simplest is **env vars
   read once at store construction** (`FREECODE_OUTPUT_STORE_BYTES`, etc.) in a small
   `tools/output-store/config.ts` with the defaults as constants — no new infra,
   ships in-phase. Only reach for a settings-file entry if the daemon already loads
   one worth extending.
2. `pattern` grep returns matching lines with ±N context lines; document the
   literal-vs-regex behaviour in the tool description.
3. Optional `memory graph stats`-style introspection: expose store size / eviction
   count via existing session stats if cheap. (Skip if it needs new IPC.)

**Verify:** lowering the byte cap forces eviction and the evicted id degrades
(D4); config changes take effect without code edits.

---

## Risks & mitigations

| Risk                                    | Mitigation                                                     |
| --------------------------------------- | -------------------------------------------------------------- |
| Store grows unbounded on huge logs      | Byte-LRU per session (16 MB) + session LRU on the factory (50 sessions) (D1) |
| Model ignores the retrieval handle      | Marker is explicit + `output` is read-only (usable in every mode); mirrors the existing "re-read narrower" hint |
| Retrieval re-overflows context          | `output` result runs through the same `adaptiveTruncate` (Phase 2.6) |
| Daemon restart loses the store          | D4: unknown id → "re-run the tool"; identical to today's loss, never throws |
| Double truncation (tool + harness)      | Tool-level truncation (e.g. `bash.ts`) is unchanged; harness layer stores whatever `displayOutput` it receives — documented as the general mechanism |
| Stale second truncation path            | `mapToolResult` (dead duplicate of the live inline path) is deleted in Phase 1.4, not left to diverge |
