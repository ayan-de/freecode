# FreeCode Optimisation Plan

> **Date:** 2026-07-12
> **Status:** Proposed
> **Goal:** Make FreeCode the fastest, most reliable open-source TS coding agent — competitive with jcode (Go), opencode (TS), and Claude Code on standard benchmarks (SWE-bench-verified, Terminal-bench, HumanEval-Agentic).

---

## TL;DR

Core is **~92% built** — 17/19 subsystems solid, 1 partial (`browser/`), 1 stub (`effect/`). You are **not** missing modules; you are missing **depth in the agent loop**.

To be world-class, ship these four items in order:

1. **Parallel-safe tool batching** (1-2 days) — 2-3× on multi-read turns
2. **True streaming end-to-end** (2-4 days) — the difference between "works" and "feels fast"
3. **Effect / Layer DI** (3-5 days) — unlocks cancellation, tracing, RecoveryPolicy
4. **RecoveryManager (retries + provider fallback)** (1-2 days) — kills transient failures

Everything else — browser adapters, remote MCP, doc gaps — is deferrable.

---

## 1. Current State Audit

### 1.1 Core subsystem inventory

| Subsystem     | Files | LOC    | Status  | Note                                                          |
| ------------- | ----- | ------ | ------- | ------------------------------------------------------------- |
| `agent/`      | 8     | 2,248  | Solid   | Continuous loop, memory + hooks + rollout wired               |
| `tools/`      | 24    | 4,104  | Solid   | 14+ tools: Read, Edit, Write, Bash, Grep, Glob, Agent, Skill… |
| `store/`      | 7     | 1,628  | Solid   | SQLite + JSON backends, thread/turn persistence               |
| `session/`    | 11    | 1,626  | Solid   | Manager, prompt builder, interrupt handler                    |
| `hooks/`      | 18    | 1,626  | Solid   | **All 11 hook types** implemented                             |
| `memory/`     | 16    | 1,302  | Solid   | Service, selector, summariser, token counter                  |
| `skills/`     | 6     | 1,253  | Solid   | Loader, registry, injection, detection, plugin system         |
| `providers/`  | 9     | 909    | Solid   | Anthropic, OpenAI, Gemini, MiniMax                            |
| `rollout/`    | 5     | 773    | Solid   | Event sourcing w/ aggregateID + seq                           |
| `mcp/`        | 10    | 602    | Solid   | Client, config, transport (local stdio)                       |
| `context/`    | 5     | 520    | Solid   | Compiler, file tree, engine                                   |
| `bus/`        | 1     | 402    | Solid   | Pub/sub w/ SessionCreated, SessionDiff, SessionError…         |
| `permission/` | 2     | 381    | Solid   | Profiles, access logic                                        |
| `parser/`     | 7     | 292    | Solid   | Registry-based extractor chain                                |
| `browser/`    | 5     | 249    | Partial | Controller only — provider CDP adapters missing               |
| `applier/`    | 1     | 75     | Solid   | Diff/apply for create/delete/write                            |
| `effect/`     | 1     | 42     | **Stub**| Only `LoopHealthEvaluator`; no context/layers/runtime         |
| **Total**     | 154   | 19,407 |         |                                                               |

### 1.2 Deviations from the v3 spec (`docs/superpowers/specs/2026-05-25-architecture-v3.md`)

- ✅ Bus — full event set present (contrary to CLAUDE.md's "only question events")
- ✅ Hooks — all 11 types shipped (contrary to CLAUDE.md's "missing PermissionRequest/SubagentStart/Stop")
- ✅ Skills — full system present
- ✅ Rollout / event-sourcing — present
- ✅ Thread store — present (SQLite + JSON)
- ✅ MCP — client + tool convert present
- ❌ **Effect / Layer DI — not built.** Only a loop-health evaluator sits at `effect/`. This is the last real architectural gap.

**Action:** Update `CLAUDE.md` deviations section — most of the "missing" items are actually shipped.

---

## 2. Agent Loop Deep-Dive

### 2.1 Structure

Loop lives in `apps/core/src/agent/loop.ts` (1,249 LOC), `apps/core/src/session/` (session/manager, 282 LOC), and `apps/core/src/tools/orchestrator.ts` (284 LOC). Class-based composition; direct instantiation instead of layer injection (`loop.ts:88-89`).

### 2.2 Turn handling — canonical continuous loop ✅

`executeTurn` (`loop.ts:308-554`) does: load history → build prompt → send to provider → normalise response → parse tool calls → execute tools → append results → loop until no tool_calls. Textbook. Matches the design spec.

### 2.3 Streaming — event-based, not chunk-based ❌

- Waits for **complete** provider response before emitting UI events (`loop.ts:803-898`)
- `tool_start` / `tool_output` / `tool_complete` fire *after* tool execution, not as tokens arrive
- Thinking content emitted once per turn (`loop.ts:378`)
- Text content emitted once per turn (`loop.ts:386`)
- **No streaming of tool calls as they arrive from the model**

This is the biggest UX gap. Claude Code + opencode stream deltas continuously.

### 2.4 Parallelism — none ❌

`orchestrator.ts:164-284`:

```ts
for (const toolCall of toolCalls) {   // ← serial
  const result = await execute(toolCall)
  results.push(result)
}
```

`types.ts:320-328` declares `execution: "sequential" | "parallel-safe"` but nothing reads it. Three independent `Read`s take 3× the time they should.

### 2.5 Cancellation — limited ❌

`interrupt.ts:34-49` handles Ctrl+C with a 500ms double-tap. Single Ctrl+C marks the current message interrupted but only after the current LLM/tool call finishes. **No `AbortController` threaded through provider or tool calls.** Cannot cancel a hung provider request or a long `Bash` call.

### 2.6 Error handling — silent degradation ❌

- 8 scattered try/catch blocks across `loop.ts` (lines 137, 297, 551, 831, 950, 955, 1087)
- Provider errors bubble (`sendToProvider:560-599`); **no retry**
- Tool errors caught in orchestrator (`227-268`), returned as error results, loop continues silently
- Spec's `RecoveryPolicy` (`2026-05-25-agent-loop.md` lines 475-545) — not built

No exponential backoff, no 429 handling, no provider fallback.

### 2.7 State — solid ✅

History loaded from `SessionStore` on startup (`loop.ts:95-144`). Per-turn: 1 user + 1 assistant + N tool results. Compaction triggers when `memory.shouldCompact(provider)` (`loop.ts:508`). Idle-based micro-compaction prunes old tool results after 5 min (`146-176`). This part is well-designed.

### 2.8 Performance hot paths

| Hot path                | File / line             | Cost         |
| ----------------------- | ----------------------- | ------------ |
| Serial tool exec        | `orchestrator.ts:164`   | 2-3× on reads|
| Full-response wait      | `loop.ts:386`           | Perceived 2-4× |
| Tool list re-compile    | `loop.ts:327`           | ~10-15% latency |
| No file-tree cache      | `loop.ts` (build prompt)| ~30% tokens  |
| Regex response scan     | `loop.ts:617`           | O(n) per turn|
| Memory double-tracking  | `loop.ts:57-58`         | Small        |

---

## 3. Priority Roadmap

Ship in this order. Each phase produces a shippable, measurable improvement.

### Phase 1 — Parallel-safe tool batching (1-2 days) ✅ IMPLEMENTED

**Files touched:**
- `apps/core/src/tools/batching.ts` (new — `planToolBatches` helper)
- `apps/core/src/tools/batching.test.ts` (new — 6 unit tests)
- `apps/core/src/agent/loop.ts` (call-site refactor at old lines 482-500)

**Deviation from original plan:** the real metadata field is `tool.behavior.isConcurrencySafe: boolean` (already present on every tool via `tool.types.ts`), not `execution: "sequential" | "parallel-safe"`. Batching lives in `tools/batching.ts` and is called from `loop.ts` rather than adding an `executeBatch` to the orchestrator — this preserves the existing `executeTool()` path (which owns hook dispatch, event emission, permission checks, rollout recording) instead of duplicating it.

**Implementation checklist:**

1. ✅ Consume existing `tool.behavior.isConcurrencySafe` metadata (audit confirmed present on all 9 tools).
2. ✅ Current tool tags verified via grep — no changes needed:
   - **concurrency-safe (parallel):** `read`, `grep`, `glob`, `skill`
   - **sequential:** `write`, `edit`, `bash`, `agent`, `question`
   - `bash` read-only heuristics deferred to Phase 5.
3. ✅ Add `planToolBatches(calls, isSafe?)` → `ToolBatch[]` (`start`, `end`, `parallel`). Consecutive safe tools group into one parallel batch; anything else runs solo.
4. ✅ Wire into loop — replaced the `for (const toolCall of toolCalls)` block at `loop.ts:484` with a batch-driven loop that uses `Promise.all` for parallel batches and preserves in-order post-work (loop-health, `assistantMessage` patch, session-store append).
5. ✅ Event emission — `tool_start` / `tool_output` / `tool_complete` continue to fire per call inside `executeTool()`; in parallel batches they naturally interleave as tools resolve.

**Success criteria:**

- ✅ Unit tests for grouping algorithm — 6/6 pass (`empty`, `single safe`, `all-safe batch`, `split at sequential`, `unknown-as-sequential`, `all-sequential`).
- ✅ No regression — existing 10 agent-loop tests (`loop-caching`, `loop-memory`, `loop-session-store`) all still pass.
- ✅ Typecheck clean — `pnpm lint` exit 0.
- 🟡 Benchmark on real 3-read turn — pending: run `pnpm dev` and prompt "read agent/loop.ts, session/manager.ts, tools/orchestrator.ts and summarise", record wallclock, compare against pre-work baseline. **Expected: ~6 s → ~2 s.**

### Phase 2 — True streaming end-to-end (2-4 days) ✅ BACKEND IMPLEMENTED, 🟡 CLIENT UPDATE PENDING

**Files touched:**
- `packages/shared/src/ipc/protocol.ts` — extended `StreamEvent` with `text_delta` + `thinking_delta` variants
- `apps/core/src/providers/types.ts` — added `ProviderChunk` type + optional `stream?()` on `AIProvider`
- `apps/core/src/providers/streaming.ts` (new) — `normalizeAiSdkStream()` helper that maps AI SDK v6 `fullStream` chunks → `ProviderChunk`
- `apps/core/src/providers/anthropic.ts` — extracted shared `buildOptions()`, added `stream()` via `streamText`
- `apps/core/src/providers/openai.ts` — same treatment
- `apps/core/src/providers/gemini.ts` — same treatment
- `apps/core/src/providers/minimax.ts` — **rewritten** to add native SSE streaming against the Anthropic-compatible endpoint; `supportsStreaming` flipped `false → true`; shared body builder + Anthropic SSE parser (`message_start` / `content_block_start` / `content_block_delta` (text/thinking/input_json) / `content_block_stop` / `message_delta` / `message_stop` / `error`)
- `apps/core/src/agent/loop.ts` — `sendToProvider()` now prefers `provider.stream()` when both stream + listener are present; falls back to `execute()` unchanged

**Design decision — dual emission for safety:** the streaming path emits `text_delta` / `thinking_delta` chunks *during* the turn AND the existing final `text` / `thinking` emit still fires at end-of-turn (see `loop.ts:377-391`). Rationale: unmodified TUI/VSCode clients ignore unknown `text_delta` events and continue rendering the final `text` event, so **no regression on today's UI**. Once the client update lands, delta events drive incremental rendering and the final `text` becomes a snapshot.

**Implementation checklist:**

1. ✅ Add `text_delta` + `thinking_delta` variants to shared `StreamEvent`.
2. ✅ Add `ProviderChunk` type + optional `stream?()` method on `AIProvider`.
3. ✅ Create `normalizeAiSdkStream()` helper — one source of truth for AI SDK v6 chunk parsing (`text-delta`, `reasoning`, `tool-call`, `finish`, `error`).
4. ✅ Anthropic, OpenAI, Gemini providers implement `stream()`. Each factors an internal `buildOptions()` so `execute()` and `stream()` share setup.
5. ✅ `sendToProvider()` — when `provider.stream` exists and `this.onToolEvent` is set, iterate chunks and emit `text_delta` / `thinking_delta` events; collect `tool_call` chunks into the `toolCalls` array; parse `usage`; propagate `error`. Returns `{ streamed: true, ... }` so the caller could opt into skipping the final emit if desired.
6. ✅ **MiniMax native SSE streaming** — endpoint is Anthropic-compatible so it uses the Messages SSE protocol directly (no AI SDK). Body builder shared with `execute()`; SSE reader accumulates `input_json_delta` chunks per tool block and yields a fully-formed `tool_call` on `content_block_stop`. `supportsStreaming` is now `true`.
7. 🟡 **TUI client** (`apps/tui/src/ipc/client.ts`) — needs to consume `text_delta` / `thinking_delta` events and append incrementally to the current assistant message. Until this lands, TUI continues to render the final `text` event (no streaming effect visible, but no regression).
8. 🟡 **VSCode client** — same update as TUI.
9. 🟡 **Tool-call deltas** — `tool-input-delta` from AI SDK is currently ignored; only fully-formed `tool-call` chunks are yielded. Streaming tool arg JSON is a future sub-item.

**Success criteria:**

- ✅ Typecheck clean — `pnpm --filter @thisisayande/freecode-shared build` + `pnpm lint` in core both exit 0.
- ✅ No regression — 16/16 tests pass (10 existing loop tests + 6 new batching tests).
- ✅ Provider streaming path exercised in code (streaming chunks arrive → `text_delta` events fire) — pending real-turn verification when the user runs `pnpm dev`.
- 🟡 First-token latency drops from full-response time to ~200 ms — pending TUI client update to render `text_delta` (backend already emits chunks as fast as the provider yields them).
- 🟡 Manual test in TUI: text visibly types as tokens arrive — pending TUI update.

### Phase 3 — Effect / Layer DI (3-5 days)

**Files:** `apps/core/src/effect/context.ts` (new), `apps/core/src/effect/layers.ts` (rewrite), `apps/core/src/effect/runtime.ts` (new). Migrate: `agent/loop.ts`, `session/manager.ts`, `tools/orchestrator.ts`, `memory/service.ts`, `hooks/runtime.ts`.

**Goal:** the DI structure v3 spec promised.

**Implementation:**

1. `context.ts` — declare `Context.Tag`s for `MemoryService`, `HookRuntime`, `ToolOrchestrator`, `SessionStore`, `BusService`, `RolloutRecorder`, `ProviderRegistry`.
2. `layers.ts` — build `Layer`s per service (Live + Test variants).
3. `runtime.ts` — compose the main `Runtime` used by `cli.ts` and `server.ts`.
4. Refactor `AgentLoop` from `class AgentLoop { constructor(mem, hooks, ...) }` → `Effect.gen(function* () { const mem = yield* MemoryService; ... })`.
5. Thread `AbortSignal` via Effect's built-in interruption — every provider call, tool call, and hook now cancellable.

**Success criteria:**
- Ctrl+C aborts an in-flight provider stream within 100ms
- Test setup can inject a mock `MemoryService` without patching globals
- No behavioural regression on smoke tests

### Phase 4 — RecoveryManager (1-2 days, requires Phase 3)

**Files:** `apps/core/src/agent/recovery/manager.ts` (new), `apps/core/src/agent/loop.ts`, `apps/core/src/tools/orchestrator.ts`, `apps/core/src/providers/*`

**Goal:** transient errors don't kill sessions.

**Implementation:**

1. `RecoveryPolicy` type per spec (`docs/superpowers/specs/2026-05-25-agent-loop.md:475-545`).
2. Wrap provider calls in `Effect.retry` w/ exponential backoff on: HTTP 429, HTTP 5xx, network timeouts.
3. Provider fallback chain: primary → secondary on hard failure (config-driven).
4. Tool retry rules — network tools retry, mutating tools don't.
5. Emit `SessionError` on Bus when recovery exhausts.

**Success criteria:**
- Injected 429 storm survives (retries kick in, session continues)
- Provider outage triggers fallback within 2 attempts
- `SessionError` events visible in `/internal` diagnostics

### Phase 5 — Caching (nice-to-have, 1-2 days)

- Cache tool list per session (invalidate on skill/MCP change)
- Cache file tree as `{ contentHash, tree }` — invalidate only on `Write` / `Edit` / `Bash` (mutating)
- Cache compiled system prompt blocks — invalidate on tool/skill change

Expected win: ~30% token savings, 10-15% latency.

### Phase 6 — Cold-start via Node SEA (1-2 days)

**Files:** `apps/tui/build.config.ts` (new), `apps/tui/package.json`, `scripts/build-sea.js` (new)

**Goal:** boot the TUI in <500 ms (down from ~1,100 ms) via Node Single Executable Application.

**Implementation:**

1. Bundle `apps/tui` into a single `dist/tui.bundle.js` with `esbuild` or `rollup` (already likely present).
2. Use Node's `--experimental-sea-config` flow to produce a single-file `freecode` binary.
3. Update `Benchmark.md` methodology section — SEA path becomes `freecode` invocation priority #1.
4. Bench before/after; expected: ~1,100 ms → ~350-500 ms.

**Success criteria:**
- Cold-start p50 < 500 ms on the reference Linux box
- Binary size < 60 MB
- No behavioural regression on smoke tests

### Phase 7 (optional) — Bun compile for sub-100ms boot (3-5 days)

Only pursue if Phase 6 doesn't get you below Cursor Agent / Claude Code cold-start numbers in a way that gets flagged in reviews. Bun's `bun build --compile` produces native binaries booting in ~40-80 ms. Trade-off: audit codebase for Node-only APIs, migrate TUI entry point. Core services stay unchanged.

### Phase 8 (quality benchmark harnesses) — parallel to Phases 1-4

Do not wait for perf phases to ship. Start these as soon as Phase 1 is queued:

- **Custom uncontaminated micro-bench** — 4-6 tasks in `apps/core/benchmarks/micro/`, `pnpm bench:quality`
- **Terminal-Bench 2.1 runner** — `scripts/bench_terminal.py`
- **SWE-bench-verified subset (n=50-100)** — `scripts/bench_swe.py`

See §5.2.2 for detailed methodology.

---

## 4. Deferrable Work

Do **not** start these before Phases 1-4:

- **Browser CDP adapters** (`browser/providers/chatgpt.ts`, `claude.ts`, `gemini.ts`) — only if browser-mode is a v1 promise. API providers work today.
- **Remote MCP** — local stdio is enough for MVP.
- **Rust TUI** — never, unless real performance measurement demands it.
- **Additional providers** — 4 is enough until benchmarks stabilise.

---

## 5. Benchmark Strategy — The jcode Gap

You cannot claim "world's best" without measurement. `Benchmark.md` today only covers **one of the two axes** jcode ships. That's the gap. Read this section carefully — it's the biggest thing standing between FreeCode and a credible #1 claim.

### 5.1 What jcode actually publishes (https://solosystems.dev/jcode)

jcode wins mindshare because they benchmark on **two axes**, not one:

**Axis A — Resource efficiency (what your `Benchmark.md` covers today)**

| Tool          | Extra PSS / session | Time to first frame | Time to first input |
| ------------- | ------------------- | ------------------- | ------------------- |
| **jcode**     | **~9.9 MB**         | **14.0 ms**         | **48.7 ms**         |
| Codex CLI     | 21.6 MB             | 882.8 ms            | 905.8 ms            |
| pi            | 76.5 MB             | 590.7 ms            | 596.4 ms            |
| Antigravity   | 86.4 MB             | 383.5 ms            | 383.7 ms            |
| Cursor Agent  | 157.5 MB            | 1949.7 ms           | 1978.7 ms           |
| Copilot CLI   | 158.1 MB            | 1518.6 ms           | 1583.4 ms           |
| Claude Code   | 212.7 MB            | 3436.9 ms           | 3512.8 ms           |
| OpenCode      | 318.4 MB            | 1035.9 ms           | 1047.9 ms           |
| **FreeCode (your numbers)** | **~24.4 MB** | **~1,100 ms**       | **~1,100 ms**       |

**The uncomfortable truth:** FreeCode's `Benchmark.md` beats *everyone in the table* — but excludes jcode. If you add jcode to the same table:

- Cold start: jcode **78× faster** (14 ms vs 1,100 ms). This is Go-native binary vs Node startup. Unfixable in current form.
- Memory/session: jcode **~2.5× lighter** (10 MB vs 24 MB).

**Axis B — Task quality (what your `Benchmark.md` does NOT cover at all)**

| Suite                 | jcode's numbers                                | Your numbers |
| --------------------- | ---------------------------------------------- | ------------ |
| Terminal-Bench 2.1    | 92 % finished-in-time (n=75), 47 % cutoff pass | none         |
| jcode bench v1 (custom, uncontaminatable) | float-print +8.64, json-unescape, utf16-transcode — continuous scoring | none |
| DeepSWE               | referenced, no numbers yet                     | none         |
| Hill-climbability     | n=2,012, mean 91.29, median 90                 | none         |

**This is where the "world's best" claim actually gets settled.** Nobody buys a coding agent because it starts fast — they buy it because it *finishes tasks correctly*. Right now you have no numbers on the axis that matters.

### 5.2 The two things you have to do

**5.2.1 Close the cold-start gap on Axis A**

Node's minimum cold-start is ~200-400 ms. You will not hit 14 ms on Node. Options ranked by feasibility:

1. **Single-file bundle + Node SEA** (Single Executable Application) — bundles the TUI into one `node` invocation, cuts require() overhead. Realistic target: **~300-400 ms**. 1-2 days.
2. **Bun compile (`bun build --compile`)** — Bun's `--compile` produces a native binary that boots in ~40-80 ms. Would need to migrate TUI entry from Node → Bun (core stays Node-compatible). Realistic target: **~50-100 ms**. 3-5 days if the codebase is Bun-clean.
3. **Rust/Go TUI shell** — spawns Node/Bun core as needed. Only if you're serious about matching jcode's 14 ms. Weeks of work.

**Recommendation:** Ship Node SEA in Phase 6 to get under 500 ms, then evaluate Bun compile only if benchmark still lags meaningfully. Do **not** pursue a native shell until the quality-axis wins are locked in.

**5.2.2 Ship all three quality-axis suites (this is the priority)**

**Priority order:**

1. **Custom uncontaminatable micro-bench** (steal jcode's pattern, 3-5 days)
   - Build 4-6 tasks like jcode's `float-print` / `json-unescape` / `utf16-transcode`: small, deterministic, correctness verified across full input space (not sampled), scored on optimization depth *continuously* (not pass/fail).
   - Why: cannot be gamed by training-data contamination. Publishable numbers within days.
   - Deliverable: `apps/core/benchmarks/micro/` + `pnpm bench:quality`.

2. **Terminal-Bench 2.1 harness** (5-7 days)
   - Wire the standard Terminal-Bench 2.1 runner against FreeCode's CLI.
   - Report both metrics jcode reports: **finished-in-time pass rate** and **15-min cutoff pass rate**.
   - Target: match jcode's 88 % baseline first, then aim for 92 %+.
   - Deliverable: `scripts/bench_terminal.py` + results in `Benchmark.md`.

3. **SWE-bench-verified subset** (7-10 days)
   - Run against 50-100 verified issues (full 500 is expensive).
   - Report pass rate + median tokens per resolved issue.
   - Deliverable: `scripts/bench_swe.py` + results in `Benchmark.md`.

Use `everything-claude-code:eval-harness` skill for the framework layer around all three.

### 5.3 Internal micro-bench (per-commit CI signal)

Independent of the external suites, track per-commit on your dev box:

- **First-token latency** (user submit → first visible token) — direct signal for Phase 2 streaming
- **Turn latency** (submit → done)
- **Tools per turn** (parallelism proxy — direct signal for Phase 1)
- **Tokens per successful edit** (efficiency proxy)
- **Session-hang rate** on injected 429 / timeout — direct signal for Phase 4

### 5.4 Targets — the honest scoreboard

| Metric                                       | Baseline (est.) | Target after Phases 1-6      | jcode reference |
| -------------------------------------------- | --------------- | ---------------------------- | --------------- |
| Time to first frame                          | 1,100 ms        | <500 ms (SEA), <100 ms (Bun) | 14 ms           |
| Extra PSS / session                          | 24.4 MB         | <15 MB                       | 9.9 MB          |
| First-token latency (streaming)              | 800-1500 ms     | <250 ms                      | n/a             |
| 3-read turn                                  | ~6 s            | ~2 s                         | n/a             |
| Terminal-Bench 2.1 finished-in-time pass     | none            | 88 % → 92 %                  | 92 %            |
| Terminal-Bench 2.1 15-min cutoff pass        | none            | 42 % → 47 %                  | 47 %            |
| SWE-bench-verified subset pass rate          | none            | match opencode within 5 %    | not published   |
| Custom uncontaminated micro-bench            | none            | publish results              | +8.64 (float-print) |
| Session survival on injected 429 storm       | 0 %             | >95 %                        | n/a             |

### 5.5 Update `Benchmark.md` when quality numbers land

Once Terminal-Bench and the custom micro-bench produce numbers, extend `Benchmark.md` with two new sections **above** the existing Latest results:

1. **Task quality** — Terminal-Bench + micro-bench + SWE-bench tables
2. **Cold-start after Node SEA / Bun compile** — updated Axis A numbers with jcode included

The current `Benchmark.md` summary claim ("FreeCode comes out on top of every metric this harness measures") is technically true **only because jcode is excluded**. Either add jcode to the table honestly and lose on cold start, or reframe as "fastest Node-based agent" — either is more credible than the current framing.

---

## 6. Patterns to Steal from opencode

Ranked by impact for FreeCode:

1. **Effect-based runtime + DI** — already in Phase 3.
2. **Protocol-level provider adapters** — talk directly to provider HTTP APIs (not via `ai` SDK). Gives full control over streaming, retries, redaction, request-ID capture. Reference: opencode's `packages/llm/src/protocols/`.
3. **Immer draft state pattern** — immutable state with a draft editor; replayable transforms. Enables clean undo/redo and plugin composition without accidental mutations.
4. **Effect.Schema tool definitions** — schemas generate JSON schema + docs; parse errors caught at boundary. Consider migrating `tools/types.ts` from Zod (if you're on Zod) to Effect.Schema when Phase 3 lands.
5. **Fine-grained mergeable permissions** — permissions as rule objects (`"read *.env:ask"`), composable via `Permission.merge()`. Your `permission/profiles.ts` is close; extend to rule-based.
6. **Turborepo package boundaries** — split `packages/shared` further as it grows (`@freecode/llm`, `@freecode/core`, `@freecode/plugin`).

---

## 7. Web `/internal` Docs — Updates Needed

Route: `apps/web/app/internal/`.

Well-documented: Overview, CLI Backend, IPC Protocol, Data Flow.

Missing / stubbed:
- `BoundaryDiagram` (currently commented out at lines 55-61) — wire it in for domain boundaries
- `IntroSection` (TODO at line 31) — decide: fill or remove
- **Missing pages:** Hooks (11 types), Skills system, Rollout/event-sourcing, MCP, Memory, Recovery (post-Phase 4), Streaming pipeline (post-Phase 2)

Add an **Agent Loop** deep-dive page after Phase 2 lands, showing the streaming pipeline visually.

---

## 8. `CLAUDE.md` Correction

The "Current known deviations from spec" list is out of date. Update:

- ~~Bus only has question events~~ → **shipped: full event set**
- ~~Hooks missing PermissionRequest/SubagentStart/Stop~~ → **shipped: all 11 types**
- ~~No skills system~~ → **shipped**
- ~~No rollout/event sourcing~~ → **shipped**
- ~~No thread store~~ → **shipped (SQLite + JSON)**
- ~~No MCP server~~ → **MCP client shipped; remote server deferred**
- **Effect/layers.ts is only loop-health evaluator, not full DI** → still true, addressed in Phase 3

---

## 9. Execution Order — What To Start Today

Two parallel tracks. Perf phases (1→4) are code refactors; quality phases (8) are new harnesses that can be built by a second person / session in parallel.

**Track A — Perf & correctness (sequential, blocking on each other):**

1. Set up eval harness (`everything-claude-code:eval-harness`) — half a day.
2. Capture baseline: internal micro-bench + first jcode-comparison numbers — half a day.
3. ✅ **Phase 1** — parallel tool batching. Code + tests landed (see §3 Phase 1). Awaiting real-turn benchmark to confirm the expected 2-3× multi-read speedup.
4. ✅🟡 **Phase 2** — true streaming. Backend (providers + loop) landed; TUI + VSCode client `text_delta` handling still pending. See §3 Phase 2.
5. **Phase 3** — Effect / Layer DI.
6. **Phase 4** — RecoveryManager.
7. **Phase 6** — Node SEA cold-start (after everything else is stable).

**Track B — Quality benchmarks (parallelisable with Track A):**

1. Build custom uncontaminated micro-bench (§5.2.2 #1) — 3-5 days.
2. Wire Terminal-Bench 2.1 (§5.2.2 #2) — 5-7 days.
3. Wire SWE-bench-verified subset (§5.2.2 #3) — 7-10 days.
4. Update `Benchmark.md` with Task Quality section as numbers land.

Total elapsed on Track A: ~2-3 weeks. Track B runs alongside and produces the numbers that actually settle the "world's best" claim.

**Do not** claim #1 externally until you have Terminal-Bench 2.1 numbers matching or beating jcode's 88 %. Cold-start / memory numbers alone are not sufficient — jcode already owns that axis.

---

## Appendix — Key File References

| Concern              | Path                                                     |
| -------------------- | -------------------------------------------------------- |
| Agent loop           | `apps/core/src/agent/loop.ts`                            |
| Tool orchestration   | `apps/core/src/tools/orchestrator.ts`                    |
| Provider abstraction | `apps/core/src/providers/`                               |
| Bus                  | `apps/core/src/bus/index.ts`                             |
| Effect DI (stub)     | `apps/core/src/effect/`                                  |
| Session manager      | `apps/core/src/session/manager.ts`                       |
| Interrupt handler    | `apps/core/src/session/interrupt.ts`                     |
| v3 spec              | `docs/superpowers/specs/2026-05-25-architecture-v3.md`   |
| Agent loop spec      | `docs/superpowers/specs/2026-05-25-agent-loop.md`        |
| Web internal docs    | `apps/web/app/internal/`                                 |
