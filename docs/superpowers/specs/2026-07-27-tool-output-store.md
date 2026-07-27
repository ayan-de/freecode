# Tool-Output Store & Adaptive Truncation

**Date:** 2026-07-27
**Status:** Implemented (2026-07-27) — `apps/core/src/tools/output-store/` + `tools/output.ts`
**Supersedes:** none (extends the tool orchestrator)
**Companion plan:** `docs/superpowers/plans/2026-07-27-tool-output-store.md`
**Prior art:** opencode `src/tool/truncate.ts` + `core/tool-output-store.ts`
(gap item #11 in `plans/other-tools/2026-07-18-opencode-feature-gap-analysis.md`).

---

## 1. Problem

`tools/orchestrator.ts` caps tool output at `MAX_MODEL_OUTPUT_CHARS = 30_000`
(`capModelOutput`, line 24). Above the cap it keeps the **head** and **discards
the tail**:

```
const kept = output.slice(0, MAX_MODEL_OUTPUT_CHARS);
```

The full text already exists on the result as `displayOutput` (line 119) — but the
model only ever sees `modelOutput`, and the discarded tail is **unrecoverable from
the model's side**. Its only options are to:

1. re-run the exact command (bash/grep) — paying the full output cost *again*, or
2. re-read the file at a different offset — a second round-trip.

Both burn tokens and a turn to recover data the process **already produced this
turn**. For a coding agent, tool output (grep hits, build logs, large file reads)
is the single largest token consumer, so this double-spend is the highest-value
efficiency leak left after the memory KG.

## 2. Goals

- **Never pay twice for output already produced.** The full output is stored; the
  model retrieves any slice on demand instead of re-running the tool.
- **Cut tokens per turn.** Inject a bounded *view* (head + tail bookends) plus a
  retrieval handle, not the whole blob and not a lossy head.
- **Zero new dependencies, minimal surface.** Reuse `displayOutput`, which already
  carries the full text; add one in-memory store and one retrieval tool.
- **Never break the loop.** A store miss (evicted / restarted) degrades to "re-run
  the tool" — exactly today's behaviour, so this is a pure enhancement.

### Non-goals

- Persisting outputs to disk across daemon restarts — outputs are ephemeral;
  in-memory per session is enough (a restart re-runs the tool). Revisit only if
  measured.
- Semantic search over outputs — retrieval is by id + line range (+ optional
  literal grep). No embeddings here.
- Changing any tool's own internal truncation (e.g. `bash.ts` `truncateOutput`).
  Those stay; this is the harness-level layer above them.

## 3. Key design decisions

### D1 — The store is per-session, in-memory, LRU-bounded

Outputs are keyed by `toolCallId` (already unique per call). The store lives beside
the session in the long-running daemon, holds the **full** `displayOutput`, and is
LRU-bounded by **total bytes** (default ~16 MB/session) so a runaway build log can't
grow memory without limit. Dropped on `session.delete`. No disk spill (non-goal).

### D2 — Adaptive truncation keeps head *and* tail

Replace head-only truncation with **bookends**: keep the first `HEAD` and last
`TAIL` characters (e.g. 22k head / 6k tail) joined by a marker. Build errors,
stack traces, and summaries usually live at the *end* of output — head-only
truncation throws away exactly the part the model most needs. The marker names the
retrieval handle:

```
... [truncated 142_310 chars — use `output` tool: id=<toolCallId>, offset, limit] ...
```

### D3 — Retrieval is a new read-only tool: `output`

A first-class tool (built via `factory.ts`) the model calls to fetch more:

```
output(id: string, offset?: number, limit?: number, pattern?: string)
```

- `offset`/`limit` — line range into the stored output (default: next window after
  the head).
- `pattern` — optional literal substring / regex filter, returning matching lines
  with context. Cheap; no index.
- Its **own** result is capped by the same `capModelOutput`, so retrieval can't
  re-overflow — the model pages through a huge output in bounded chunks.

Read-only (no mutation) ⇒ allowed in every mode; must be added to `READONLY_TOOLS`.

### D4 — Graceful degradation

If the id isn't in the store (evicted, or daemon restarted since the call), `output`
returns a clear, non-error message: *"output for <id> is no longer cached — re-run
the original tool to regenerate it."* Never throws into the loop. This is strictly
better than today (where the tail is simply gone).

## 4. Module layout (`apps/core/src/tools/output-store/`)

| File            | Responsibility                                                           |
| --------------- | ------------------------------------------------------------------------ |
| `store.ts`      | `OutputStore`: per-session `Map<toolCallId, string>`, byte-LRU, `get/put/slice/grep/dispose` |
| `truncate.ts`   | `adaptiveTruncate(text)` → head+tail bookends + reference marker (replaces `capModelOutput`) |
| `index.ts`      | `getOutputStore(sessionId)` factory + `disposeOutputStore(sessionId)` (LRU over sessions) |

Plus the tool itself: `tools/output.ts` (+ `tools/output/ui.ts`).

## 5. Integration points (surgical)

1. `tools/orchestrator.ts` — after building the result, `store.put(ctx.sessionId,
   call.id, displayOutput)`; replace `capModelOutput` with `adaptiveTruncate`,
   threading the `toolCallId` into the marker. **`sessionId` is already on
   `ToolContext` (`tools/types.ts:3`) and already threaded** — `loop.ts` builds
   `{ cwd, sessionId, abort }` before every `orchestrator.execute()`, so nothing to
   add; just read `ctx.sessionId`.
   **Dead-code cleanup (required, not optional):** `capModelOutput` has two call
   sites — `mapToolResult` (lines 102–126) and an inline copy in `execute` (lines
   268–303). Only the inline path is live; `mapToolResult` is stale. When swapping in
   `adaptiveTruncate`, **delete `mapToolResult`** (or unify onto it) so a second,
   divergent truncation path isn't left behind.
2. `tools/output.ts` + `tools/output/ui.ts` — the retrieval tool.
3. `tools/index.ts` — register `output` in the tools map.
4. `permission/mode-policy.ts` — add `output` to `READONLY_TOOLS`.
5. `permission/suggest.ts` — add `output` to `DISPLAY_NAMES` ("Output").
6. `tools/factory.ts` — add `output` to the `defaultToolUI.renderToolUseTag` colors
   map (keyed by tool id, same shape as `DISPLAY_NAMES`); without it the TUI renders
   the tag with the fallback white.
7. `server.ts` — call `disposeOutputStore(sessionId)` next to the existing
   `disposeSessionMemory(sessionId)` on `session.delete` (line 599). **Intentional:**
   `session.archive` (line 589) does *not* dispose — an archived-then-resumed session
   keeps its output store, matching the existing memory-store precedent. Only
   `delete` drops it.

(No `permission/rules.ts` change: `output` takes an id, not a path/url. No collision
with `grep.ts` — that's a separate ripgrep subprocess; `output`'s `pattern` is an
in-memory filter over already-stored text.)

## 6. Scalability & maintenance

- **Memory**: bounded per session by total bytes (LRU-evict oldest outputs first);
  bounded across sessions by an LRU on the store factory. Both configurable.
- **Retrieval cost**: O(size of the requested slice), never the whole store.
- **No persistence**: a daemon restart drops the store → D4 degradation.

## 7. Success criteria

- A tool output > cap is stored in full; an `output` call with an offset returns the
  previously-discarded tail **without re-running the tool** (token-saving test:
  bytes-to-model for tail-retrieval ≪ bytes for a re-run).
- Truncated model output now contains both head and tail of the source.
- `output` on an unknown id returns the degradation message, not an error; loop
  never throws.
- Evicting an output (exceeding the byte cap) and requesting it yields the same
  degradation path.
- `output`'s own result is itself capped (no re-overflow).
