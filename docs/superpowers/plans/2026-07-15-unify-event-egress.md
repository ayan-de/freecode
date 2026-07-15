# Unify Core's Event Egress onto the Bus — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the bus the **single source of truth** for everything `apps/core` emits to frontends, with **one egress**: `bus.subscribeAll → busEventToClientEvent → stdout + SSE` (the bridge already built in `2026-07-14-bus-frontend-wiring.md`). Eliminate the parallel `onToolEvent` callback path and the tool-event double-emit, so every outbound event has exactly one representation and one exit.

**Why (the smell):** Core has two undesigned egress paths — a per-session `onToolEvent` callback (threaded by hand through `run()` → `executeTurn` → `executeTool`) and the process-global bus. The loop emits each tool's lifecycle on **both** (`onToolEvent` `tool_start`/`tool_complete` *and* `BusEvents.toolCalled`/`toolCompleted`). The bus copies have no subscribers and, since the bridge landed, are written to stdout and ignored. Two mechanisms, overlapping by accident, no single owner per event.

**North star vs. interim:** The end state (this plan) is **Option A** — one channel. A deliberately smaller alternative, **Option B** (keep two channels but delete the overlap), is described in Notes as a fallback if the streaming migration proves too risky to land now. Prefer A; bail to B only if Task 4's manual streaming check regresses.

**The core idea that makes A safe:** keep `StreamEvent` as the *wire language*, and let the bus merely *transport* it. Add one bus event `{ type: "stream"; sessionId: string; event: StreamEvent }`. The loop publishes `stream` events instead of calling `onToolEvent`; the bridge unwraps them back to the inner `StreamEvent`. Nothing about the frontend wire format changes — only *how the event travels inside core*.

**Tech Stack:** TypeScript ESM (`.js` import suffix), Node stdlib + existing deps. Tests: `node:test` + `node:assert/strict`, colocated `*.test.ts`, run via `pnpm tsx --test <file>` from `apps/core/`.

## Global Constraints

- No new npm dependencies.
- Local imports use the `.js` suffix (ESM).
- New files stay under ~150 lines (CLAUDE.md convention).
- **Do not change the `StreamEvent` wire format** — frontends must keep parsing identical lines. This plan changes *internal transport only*.
- The streaming path is the hot path: every task that touches it must be guarded by a test asserting **per-session ordering** and **no double-delivery** before it lands.
- Core test commands run from `apps/core/`. Commit after each task (`feat(core): ...` / `refactor(core): ...`); skip commits if the user mandates.

## Background (current egress map — verified)

- **`onToolEvent` (per-session stream), emitted in `agent/loop.ts`:** `text_delta` (`:672`), `thinking_delta` (`:676`), plus `tool_start` (`:924`), `tool_output` (`:997`), `tool_complete` (`:1029`), `thinking` (`:408`), `text` (`:415`). Threaded as `input.onToolEvent` → `this.onToolEvent`; the only producer of the callback is `server.ts:226-255` (`emitEvent`, which writes `process.stdout` + fans out to `sessionEventCallbacks`).
- **bus (global), `BusEvents.*` call sites:** `agent/loop.ts` — `sessionCreated`, `sessionError`, `sessionUpdated`×2, `toolCalled`, `toolCompleted`×5; `agent/recovery/manager.ts` — `sessionError`; `agent/subagent.ts` + `tools/agent.ts` — `subagentStarted`, `subagentCompleted`; `mcp/init.ts` — `mcpServer*`, `mcpToolsChanged`.
- **Consumers of the bus:** only `tools/defs-cache.ts` (`tools.changed`, `mcp.tools.changed`) + the bridge (`server.ts`, `subscribeAll`). `tool.called`/`tool.completed` have **no subscriber** — pure redundancy with the stream `tool_*` events.
- **Gate quirk:** `loop.ts:653` chooses streaming vs one-shot via `if (aiProvider.stream && this.onToolEvent)`. Removing `onToolEvent` changes this gate — see Task 3 (decision: stream whenever the provider supports it).
- **Known adjacent risk (from the prior plan):** the stdin request loop `await`s each `handleRequest`; unrelated here but do not regress it.

## Target architecture

```
 loop / hooks / subagent / mcp        ← publishers (only the bus, never a callback)
              │  bus.publish(...)   (every session-scoped event carries sessionId)
              ▼
        ┌───────────┐
        │    BUS    │  single source of truth
        └─────┬─────┘
              │  ONE subscribeAll in startServer()
              ▼
     busEventToClientEvent(event)     ← map to StreamEvent | drop (internal-only)
              │
        ┌─────┴─────┐
        ▼           ▼
   process.stdout   sessionEventCallbacks (SSE, routed by sessionId; global events broadcast)
     (TUI)              (web)
```

No `onToolEvent`. No `emitEvent`. No event emitted twice.

## File Structure

| File | Status | Responsibility |
| --- | --- | --- |
| `apps/core/src/bus/index.ts` | Modify | Add `StreamRelayEvent` (`{ type:"stream"; sessionId; event: StreamEvent }`) to the union; add `BusEvents.stream(sessionId, event)` helper |
| `apps/core/src/bus/bridge.ts` | Modify | Unwrap `stream` events to the inner `StreamEvent`; drop redundant `tool.called`/`tool.completed` |
| `apps/core/src/bus/bridge.test.ts` | Modify | Cover `stream` unwrap + tool-event drop |
| `apps/core/src/agent/loop.ts` | Modify | Replace `this.onToolEvent?.(e)` with `BusEvents.stream(sessionId, e)`; delete `onToolEvent` field/param; drop redundant `BusEvents.toolCalled/toolCompleted`; fix the streaming gate |
| `apps/core/src/agent/types.ts` | Modify | Remove `onToolEvent` from `UserInput` |
| `apps/core/src/server.ts` | Modify | Delete `emitEvent`/`onToolEvent` wiring from `session.send`; rely solely on the `subscribeAll` bridge |
| `apps/core/src/bus/ordering.test.ts` | Create | Per-session FIFO ordering + cross-session isolation of `stream` events through the bridge |
| `apps/core/src/agent/loop-caching.test.ts` (+ siblings) | Modify | Update any test that passes `onToolEvent` to assert via the bus instead |

---

### Task 1: Add `stream` transport event to the bus vocabulary

**Files:** Modify `apps/core/src/bus/index.ts`; Modify `apps/core/src/bus/bridge.ts` + `bridge.test.ts`.

**Interfaces:**
- Produces: `StreamRelayEvent = { type: "stream"; sessionId: string; event: StreamEvent }` in the `BusEvent` union; `BusEvents.stream(sessionId, event)` publisher. `busEventToClientEvent` unwraps `stream` → `event.event`.

- [ ] **Step 1: Failing test** — extend `bridge.test.ts`:

```ts
test("a stream relay event is unwrapped to its inner StreamEvent", () => {
  const inner = { type: "text_delta", delta: "hi" } as const;
  const out = busEventToClientEvent({
    type: "stream", sessionId: "s1", event: inner,
  } as any);
  assert.deepEqual(out, inner);
});

test("redundant bus tool.called/tool.completed are dropped", () => {
  assert.equal(busEventToClientEvent({ type: "tool.called" } as any), undefined);
  assert.equal(busEventToClientEvent({ type: "tool.completed" } as any), undefined);
});
```

Run: `pnpm tsx --test src/bus/bridge.test.ts` → FAIL.

- [ ] **Step 2: Implement** — in `bus/index.ts` add the interface, add it to the `BusEvent` union, and add:

```ts
  stream: (sessionId: string, event: StreamEvent) =>
    bus.publish({ type: "stream", sessionId, event } as StreamRelayEvent),
```

(Import `StreamEvent` from `@thisisayande/freecode-shared`.) In `bridge.ts`: add `"tool.called"`, `"tool.completed"` to `INTERNAL_ONLY`; handle `stream` before the passthrough:

```ts
  if (event.type === "stream") return event.event;
```

- [ ] **Step 3: Pass** — `pnpm tsx --test src/bus/bridge.test.ts` → PASS.

- [ ] **Step 4: Commit** *(skip if user mandates no commits)* — `feat(core): add stream relay event to the bus vocabulary`

---

### Task 2: Ordering + isolation guard (write the safety net BEFORE moving the loop)

**Files:** Create `apps/core/src/bus/ordering.test.ts`.

**Interfaces:** consumes `bus`, `BusEvents.stream`, `busEventToClientEvent`. Proves the invariants the loop migration must not break.

- [ ] **Step 1: Write the guard test**

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { bus, BusEvents } from "./index.js";

test("stream events preserve per-session FIFO order", () => {
  const got: string[] = [];
  const off = bus.subscribeAll((e) => {
    if (e.type === "stream" && e.sessionId === "s1") got.push((e.event as any).delta);
  });
  ["a", "b", "c"].forEach((d) =>
    BusEvents.stream("s1", { type: "text_delta", delta: d }));
  off();
  assert.deepEqual(got, ["a", "b", "c"]);
});

test("a subscriber filtering by sessionId never sees another session's events", () => {
  const s1: unknown[] = [];
  const off = bus.subscribeAll((e) => {
    if (e.type === "stream" && e.sessionId === "s1") s1.push(e.event);
  });
  BusEvents.stream("s2", { type: "text_delta", delta: "x" });
  off();
  assert.equal(s1.length, 0);
});
```

- [ ] **Step 2: Run** — `pnpm tsx --test src/bus/ordering.test.ts` → PASS (Task 1 already provides `stream`). This is a **characterization** test: it locks the behavior the next task relies on.

- [ ] **Step 3: Commit** *(skip if mandated)* — `test(core): guard per-session stream ordering and isolation`

---

### Task 3: Move the loop from `onToolEvent` to `BusEvents.stream`

**Files:** Modify `agent/loop.ts`, `agent/types.ts`, and any loop test passing `onToolEvent`.

**Interfaces:**
- Removed: `UserInput.onToolEvent`; `AgentLoop.onToolEvent` field; `input.onToolEvent` usage.
- Changed: every `this.onToolEvent?.(e)` becomes `BusEvents.stream(this.state.sessionId, e)`. Remove `BusEvents.toolCalled`/`toolCompleted` (now redundant with the stream `tool_*` events). Streaming gate becomes `if (aiProvider.stream)` (stream whenever supported — the bus listener always exists).

- [ ] **Step 1: Update loop tests first (red)** — in `agent/loop-caching.test.ts` (and siblings that pass `onToolEvent`), replace the `onToolEvent` collector with a `bus.subscribeAll` collector filtered to the test session; assert the same events arrive in the same order. Run → FAIL (loop still calls `onToolEvent`).

- [ ] **Step 2: Migrate `loop.ts`**
  - Delete the `onToolEvent` field and `this.onToolEvent = input.onToolEvent`.
  - Replace each emission site (`:408`, `:415`, `:672`, `:676`, `:924`, `:997`, `:1029`) with `BusEvents.stream(this.state.sessionId, { ... })`.
  - Delete `BusEvents.toolCalled(...)` (`:932`) and the `BusEvents.toolCompleted(...)` calls that duplicate a `tool_complete` stream event (audit each of the 5 — keep none; the stream event is authoritative).
  - Change the streaming gate at `:653` to `if (aiProvider.stream)`. Document: one-shot `execute()` remains the fallback only when the provider has no `stream` method.
  - Remove `onToolEvent` from `UserInput` in `agent/types.ts`.

- [ ] **Step 3: Pass** — `pnpm tsx --test src/agent/*.test.ts src/bus/*.test.ts` → PASS.

- [ ] **Step 4: Commit** *(skip if mandated)* — `refactor(core): publish stream events to the bus, drop onToolEvent`

---

### Task 4: Collapse the server onto the single bridge

**Files:** Modify `apps/core/src/server.ts`.

**Interfaces:** `session.send` no longer builds `emitEvent` or passes `onToolEvent`. The already-present `bus.subscribeAll` bridge is the sole egress. The `session.send` JSON-RPC **response** (final `LoopResult`) is unchanged.

- [ ] **Step 1: Remove the redundant emitter**
  - Delete the `emitEvent` closure and `onToolEvent: emitEvent` from the `session.send` handler.
  - Keep emitting the terminal `{ type: "done" }` — but publish it via `BusEvents.stream(sessionId, { type: "done", content })` so it flows through the one egress too.
  - `sessionEventCallbacks` is now written **only** by the bridge (it already routes by `sessionId`); confirm web SSE still receives events.

- [ ] **Step 2: Full suite** — from `apps/core/`: `pnpm test`. Expected: green except the pre-existing unrelated failures (`mcp/convert-tool.test.ts`, `session/manager.test.ts`, `session/store.test.ts` → missing `vitest`; `memory/summarizer.test.ts` drift). Do not fix those here.

- [ ] **Step 3: MANUAL streaming verification (required — hot path)**
  1. `pnpm --filter @thisisayande/freecode-core build`; start the TUI in a project.
  2. Send a prompt that produces a long streamed answer + a couple of tool calls.
  3. Confirm: text streams token-by-token in order, tool rows appear once (not doubled), thinking renders, and the turn ends cleanly.
  4. Trigger the `question` tool; confirm the picker still works end-to-end (regression of the prior plan).
  5. If tokens arrive out of order or duplicated → **stop**; the bug is in Task 3's emission order or a stray second writer. Do not ship.

- [ ] **Step 4: Commit** *(skip if mandated)* — `refactor(core): make bus.subscribeAll the sole frontend egress`

---

## Manual verification (after all tasks)

Run Task 4 Step 3 in full. Additionally: open the web app (`/events` SSE) for a session and confirm it receives the same stream, and that a second session's events do not leak into the first (cross-session isolation — the invariant from Task 2, now exercised end-to-end).

## Notes / deferred (do NOT implement unless stated)

- **Option B (fallback, smaller):** if Task 4's manual streaming check regresses and can't be quickly fixed, abandon the loop migration and instead land only: (1) delete the redundant `BusEvents.toolCalled/toolCompleted` from the loop, (2) add them to `INTERNAL_ONLY`. This removes the double-emit and clarifies ownership (stream = turn output via `onToolEvent`; bus = notifications) **without** touching the hot path. It is strictly less unified than A but zero-risk. Ship B, keep A for later.
- **Ordering across concurrent sessions:** `EventEmitter` is synchronous and FIFO per emitter, so per-session order is preserved even when two sessions interleave (each frontend filters by `sessionId`). No queue needed. Do not add async buffering — it would *introduce* reordering.
- **Global singleton in tests:** the bus is process-global; tests that drive a loop must scope their `subscribeAll` collector by `sessionId` and call the returned unsubscribe in a `finally`/after each, or events leak between tests (this is why Task 2 exists first).
- **Observability sink:** once everything is on the bus, a future `subscribeAll` logger/metrics/rollout sink is trivial to add at the single egress — but that is a separate plan; do not build speculative sinks now (YAGNI).
- **`compileHistorySection` / `buildContinuationPrompt` dead code** in the loop is out of scope; do not touch here.
