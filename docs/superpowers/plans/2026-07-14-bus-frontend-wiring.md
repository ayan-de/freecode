# Bus → Frontend Wiring + Question Round-Trip — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the in-process event bus (`apps/core/src/bus/index.ts`) into a real backend→frontend channel, and close the interactive-question round-trip so the `question` tool no longer hangs. After this, frontends (TUI + web) *receive* bus events, and the user can *answer* the agent's questions.

**Analogy (for reviewers):** The bus is the backend's internal intercom. Today workers make announcements but the user's screen isn't wired to the speakers, and there's no reply button. This plan runs the speaker wire out (bridge bus → stdout / SSE) and adds the reply button (`question.answer` / `question.reject` RPC + a TUI picker).

**Architecture:** One process-wide `bus.subscribeAll(...)` in `startServer()` serializes bus events to the *existing* frontend transports — stdout lines (TUI) and `sessionEventCallbacks` (web SSE). A pure mapping function (`busEventToClientEvent`) decides what each bus event looks like on the wire; unknown/internal events are dropped. The question tool's parked Promise is resolved by two new JSON-RPC methods that call the already-existing `answerQuestion` / `rejectQuestion`. The TUI renders `question_asked` with a `SelectList` (same primitive as the model picker) and replies over IPC.

**Scope:** Question round-trip end-to-end (backend + protocol + TUI picker) **plus** the generic bus→frontend bridge so `session.*`, `subagent.*`, and `mcp.*` events also reach frontends. Bespoke TUI rendering for those non-question events is **deferred** (they are forwarded; the TUI ignores unknown event types safely). The **web-app** receives all events via SSE but its interactive question UI is **deferred** — the reply RPC methods work for it already.

**Tech Stack:** TypeScript ESM (imports use `.js` suffix), Node stdlib + existing deps only — no new dependencies. Tests: `node:test` + `node:assert/strict`, colocated `*.test.ts`, run via `pnpm tsx --test <file>` from `apps/core/`. TUI uses `@earendil-works/pi-tui` `SelectList` (already a dependency).

## Global Constraints

- No new npm dependencies.
- All local imports use the `.js` suffix (ESM, matches existing code).
- New files stay under ~150 lines (project convention from CLAUDE.md).
- Core tests use `node:test` + `assert` from `node:assert/strict`, colocated (pattern: `src/context/instructions.test.ts`).
- All core test commands run from `apps/core/`: `pnpm tsx --test <file>` for one file, `pnpm test` for the whole suite.
- Do **not** change the meaning of existing `StreamEvent` variants — only add new ones. Both frontends must keep working unchanged for non-question events.
- Commit after each task, message style: `feat(core): ...` / `feat(shared): ...` / `feat(tui): ...`.

## Background (why this exists)

- `apps/core/src/bus/index.ts` is a singleton `EventEmitter` with a 16-type event catalog and an `askQuestion`/`answerQuestion`/`rejectQuestion` request-reply helper. It is used heavily as a **publisher** (loop, hooks, subagent, mcp, recovery) but has only **one** real consumer: `tools/defs-cache.ts` subscribes to `tools.changed` + `mcp.tools.changed` for cache invalidation.
- **No bridge exists** from the bus to either frontend transport. The real frontend contract is `packages/shared/src/ipc/protocol.ts` (JSON-RPC `METHODS` for request/response + `StreamEvent` streamed to stdout during `session.send`). Tool/text/thinking streaming reaches the TUI via the loop's separate `onToolEvent → stdout` path (`server.ts:226`), **not** the bus.
- Consequently the **question loop is broken end-to-end**: `askQuestion` (`bus/index.ts:235`) publishes `question.asked` and awaits a Promise, but nothing forwards the event to a frontend and **no RPC method calls `answerQuestion`**, so every `question` tool call waits out the 5-minute timeout (`bus/index.ts:251`) and errors.
- Two mechanical gaps found while reading:
  1. `askQuestion(requestId, questions)` publishes `{ type, requestId, questions }` **without `sessionId`** (`bus/index.ts:244-248`), even though `QuestionAskedEvent` declares `sessionId` (`bus/index.ts:107-109`). Web SSE routing (`sessionEventCallbacks` keyed by `sessionId`, `web-server.ts:90`) needs it. The tool has it available as `ctx.sessionId`.
  2. The stdin request loop in `startServer` (`server.ts:562-572`) `await`s each `handleRequest` per data-chunk. The `question.answer` reply arrives in a **separate** stdin chunk (separate `data` event → separate handler invocation), so it is not blocked by the parked `session.send`. **This must be verified manually** (Task 5) — it is the load-bearing assumption of the whole round-trip.
- Reference implementations: opencode and claude-code both model this as an "ask" event on the stream + a reply on a side channel that resolves a parked call; this plan follows that shape with the codebase's existing transports.

## File Structure

| File | Status | Responsibility |
| --- | --- | --- |
| `packages/shared/src/ipc/protocol.ts` | Modify | Add `question_asked` to `StreamEvent`; add `question.answer` / `question.reject` to `METHODS` |
| `apps/core/src/bus/index.ts` | Modify | Thread `sessionId` through `askQuestion`; publish it on `question.asked` |
| `apps/core/src/tools/question.ts` | Modify | Pass `ctx.sessionId` into `askQuestion` |
| `apps/core/src/bus/bridge.ts` | Create | Pure `busEventToClientEvent(event)` mapping bus → wire event (or `undefined` to drop) (~60 lines) |
| `apps/core/src/bus/bridge.test.ts` | Create | Mapping behavior: question.asked → `question_asked`; internal events dropped; passthrough shape |
| `apps/core/src/server.ts` | Modify | `bus.subscribeAll` bridge in `startServer` (stdout + `sessionEventCallbacks`); add `question.answer` / `question.reject` handlers |
| `apps/core/src/server.test.ts` | Create | `question.answer` handler resolves a pending `askQuestion`; `question.reject` rejects it |
| `apps/tui/src/ipc/client.ts` | Modify | Add `answerQuestion` / `rejectQuestion` request senders |
| `apps/tui/src/components/question-picker.ts` | Create | `SelectList`-based picker for one question (~70 lines) |
| `apps/tui/src/index.ts` | Modify | Handle `question_asked` in `handleToolEvent`: mount picker, reply over IPC |

---

### Task 1: Protocol — question stream event + reply methods (shared)

**Files:**
- Modify: `packages/shared/src/ipc/protocol.ts`

**Interfaces:**
- Produces: a new `StreamEvent` variant `{ type: "question_asked"; requestId: string; sessionId?: string; questions: QuestionSpec[] }` and two new `METHODS` entries. No breaking changes to existing variants.

- [ ] **Step 1: Add the `question_asked` stream event**

In `packages/shared/src/ipc/protocol.ts`, add a shared `QuestionSpec` type (mirrors what the `question` tool sends) above `StreamEvent`:

```ts
export interface QuestionSpec {
  question: string;
  header?: string;
  options: Array<{ label: string; description: string }>;
  multiple?: boolean;
  custom?: boolean;
}
```

Add this variant to the `StreamEvent` union (append, do not reorder):

```ts
  | {
      type: "question_asked";
      requestId: string;
      sessionId?: string;
      questions: QuestionSpec[];
    }
```

- [ ] **Step 2: Add the reply methods to `METHODS`**

```ts
  "question.answer": {
    params: { requestId: "", answers: [] as string[] },
    result: undefined as void,
  },
  "question.reject": {
    params: { requestId: "" },
    result: undefined as void,
  },
```

- [ ] **Step 3: Verify types compile (no runtime test — type-only change)**

Run (from repo root): `pnpm --filter @thisisayande/freecode-shared exec tsc --noEmit`
Expected: exit 0.

- [ ] **Step 4: Commit** *(skip if user mandates no commits)*

```bash
git add packages/shared/src/ipc/protocol.ts
git commit -m "feat(shared): add question_asked stream event and question.answer/reject methods"
```

---

### Task 2: Pure bus→wire mapping (`bus/bridge.ts`)

**Files:**
- Create: `apps/core/src/bus/bridge.ts`
- Test: `apps/core/src/bus/bridge.test.ts`

**Interfaces:**
- Consumes: `BusEvent` from `./index.js`, `StreamEvent` from shared.
- Produces: `busEventToClientEvent(event: BusEvent): StreamEvent | undefined` — returns the wire event to forward, or `undefined` for internal-only events that must not reach frontends.

- [ ] **Step 1: Write the failing test**

Create `apps/core/src/bus/bridge.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { busEventToClientEvent } from "./bridge.js";

test("question.asked maps to a question_asked stream event", () => {
  const out = busEventToClientEvent({
    type: "question.asked",
    requestId: "r1",
    sessionId: "s1",
    questions: [{ question: "Pick", options: [{ label: "A", description: "a" }] }],
  } as any);
  assert.equal(out?.type, "question_asked");
  assert.equal((out as any).requestId, "r1");
  assert.equal((out as any).questions.length, 1);
});

test("internal cache-invalidation events are dropped (return undefined)", () => {
  assert.equal(
    busEventToClientEvent({ type: "tools.changed", added: [], removed: [] } as any),
    undefined,
  );
  assert.equal(
    busEventToClientEvent({ type: "mcp.tools.changed", server: "x" } as any),
    undefined,
  );
});

test("a forwarded lifecycle event keeps its type and payload", () => {
  const out = busEventToClientEvent({
    type: "subagent.started",
    subagentId: "a", subagentType: "explore", parentId: "p", task: "t",
  } as any);
  assert.equal(out?.type, "subagent.started");
});
```

- [ ] **Step 2: Run to verify it fails**

Run (from `apps/core/`): `pnpm tsx --test src/bus/bridge.test.ts`
Expected: FAIL — `Cannot find module './bridge.js'`.

- [ ] **Step 3: Implement `bus/bridge.ts`**

Map `question.asked` to the typed `question_asked` variant. Drop the two internal cache events (`tools.changed`, `mcp.tools.changed`) — frontends have no use for them and they are not `StreamEvent` shaped. Forward the remaining lifecycle events **as-is** (their `type` string is already frontend-friendly); the TUI's `handleToolEvent` switch has no `default` branch, so unknown types are ignored safely.

```ts
// =============================================================================
// Bus → Frontend bridge (pure mapping)
// Decides how each internal bus event appears on the frontend wire.
// Returns undefined for internal-only events that must NOT reach frontends.
// =============================================================================

import type { BusEvent } from "./index.js";
import type { StreamEvent } from "@thisisayande/freecode-shared";

const INTERNAL_ONLY = new Set(["tools.changed", "mcp.tools.changed"]);

export function busEventToClientEvent(
  event: BusEvent,
): StreamEvent | undefined {
  if (INTERNAL_ONLY.has(event.type)) return undefined;

  if (event.type === "question.asked") {
    return {
      type: "question_asked",
      requestId: event.requestId,
      sessionId: event.sessionId,
      questions: event.questions,
    };
  }

  // Lifecycle/progress events (session.*, subagent.*, mcp.server.*, tool.*)
  // are forwarded verbatim; frontends render what they recognize and ignore
  // the rest. Cast: these carry richer payloads than the base StreamEvent
  // union, which frontends read structurally.
  return event as unknown as StreamEvent;
}
```

- [ ] **Step 4: Run to verify it passes**

Run (from `apps/core/`): `pnpm tsx --test src/bus/bridge.test.ts`
Expected: PASS — 3 tests, 0 failures.

- [ ] **Step 5: Commit** *(skip if user mandates no commits)*

```bash
git add apps/core/src/bus/bridge.ts apps/core/src/bus/bridge.test.ts
git commit -m "feat(core): add pure bus-to-frontend event mapping"
```

---

### Task 3: Thread `sessionId` into questions (bus + tool)

**Files:**
- Modify: `apps/core/src/bus/index.ts`
- Modify: `apps/core/src/tools/question.ts`

**Interfaces:**
- Changed: `askQuestion(requestId, questions, sessionId?)` — new optional third arg; when present, it is published on the `question.asked` event so web SSE (`sessionEventCallbacks` keyed by sessionId) can route it. TUI is single-process and does not need it.

- [ ] **Step 1: Add `sessionId` to `askQuestion`**

In `apps/core/src/bus/index.ts`, update the signature and the published event:

```ts
export async function askQuestion(
  requestId: string,
  questions: QuestionAskedEvent["questions"],
  sessionId?: string,
): Promise<string[]> {
  return new Promise((resolve, reject) => {
    pendingQuestions.set(requestId, { resolve, reject });
    bus.publish({
      type: "question.asked",
      requestId,
      sessionId,
      questions,
    } as QuestionAskedEvent);
    // ...existing timeout unchanged...
  });
}
```

(`QuestionAskedEvent.sessionId` already exists but is currently optional-in-practice; leave the interface as-is or mark `sessionId?` optional to match.)

- [ ] **Step 2: Pass `ctx.sessionId` from the tool**

In `apps/core/src/tools/question.ts`, change `executeQuestion(params, _ctx)` to use the context and forward the id:

```ts
async function executeQuestion(params: QuestionParams, ctx: ToolContext) {
  // ...
  const answers = await askQuestion(requestId, questions, ctx.sessionId);
  // ...
}
```

Confirm `ToolContext` exposes `sessionId` (the loop builds `{ cwd, sessionId, abort }` at `loop.ts:947-951`). If the local `ToolContext` type omits it, read it via `(ctx as { sessionId?: string }).sessionId`.

- [ ] **Step 3: Verify the suite still compiles/passes**

Run (from `apps/core/`): `pnpm tsx --test src/bus/bridge.test.ts` and `pnpm tsc --noEmit`
Expected: PASS / exit 0 (no dedicated runtime test — behavior is covered end-to-end by Task 4's test + Task 5 manual check).

- [ ] **Step 4: Commit** *(skip if user mandates no commits)*

```bash
git add apps/core/src/bus/index.ts apps/core/src/tools/question.ts
git commit -m "feat(core): carry sessionId on question.asked for per-session routing"
```

---

### Task 4: Server bridge + reply RPC methods

**Files:**
- Modify: `apps/core/src/server.ts`
- Test: `apps/core/src/server.test.ts` (create)

**Interfaces:**
- Consumes: `bus`, `answerQuestion`, `rejectQuestion` from `./bus/index.js`; `busEventToClientEvent` from `./bus/bridge.js`.
- Produces: two new `methodHandlers` entries (`question.answer`, `question.reject`) and a startup-time subscription that forwards bus events to stdout + `sessionEventCallbacks`.

- [ ] **Step 1: Write the failing test**

Create `apps/core/src/server.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { handleRequest } from "./server.js";
import { askQuestion } from "./bus/index.js";

test("question.answer resolves a pending askQuestion with the answers", async () => {
  const p = askQuestion("req-1", [
    { question: "Pick", options: [{ label: "A", description: "a" }] },
  ] as any);
  const res = await handleRequest({
    jsonrpc: "2.0", id: 1, method: "question.answer",
    params: { requestId: "req-1", answers: ["A"] },
  });
  assert.equal((res as any).error, undefined);
  assert.deepEqual(await p, ["A"]);
});

test("question.reject rejects a pending askQuestion", async () => {
  const p = askQuestion("req-2", [
    { question: "Pick", options: [{ label: "A", description: "a" }] },
  ] as any);
  await handleRequest({
    jsonrpc: "2.0", id: 2, method: "question.reject",
    params: { requestId: "req-2" },
  });
  await assert.rejects(p);
});
```

- [ ] **Step 2: Run to verify it fails**

Run (from `apps/core/`): `pnpm tsx --test src/server.test.ts`
Expected: FAIL — `Method not found: question.answer` (both promises would otherwise hit the 5-min timeout; the reject test's `handleRequest` returns a method-not-found error and `p` never settles). Keep the test's own timeout short if the runner blocks.

- [ ] **Step 3: Add the reply handlers**

In `apps/core/src/server.ts`, import at top:

```ts
import { bus, answerQuestion, rejectQuestion } from "./bus/index.js";
import { busEventToClientEvent } from "./bus/bridge.js";
```

Add to `methodHandlers`:

```ts
  "question.answer": async (params): Promise<void> => {
    const { requestId, answers } = params as { requestId: string; answers: string[] };
    answerQuestion(requestId, answers);
  },
  "question.reject": async (params): Promise<void> => {
    const { requestId } = params as { requestId: string };
    rejectQuestion(requestId);
  },
```

- [ ] **Step 4: Add the bus → frontend bridge in `startServer()`**

At the top of `startServer()` (after providers/mcp init), subscribe once for the process lifetime:

```ts
  // Speaker wire: forward internal bus events to both frontend transports.
  bus.subscribeAll((event) => {
    const wire = busEventToClientEvent(event);
    if (!wire) return;
    const line = JSON.stringify(wire) + "\n";
    process.stdout.write(line); // TUI reads stdout lines
    // Web SSE: route to the owning session if known, else broadcast.
    const sid = (event as { sessionId?: string }).sessionId;
    if (sid) {
      sessionEventCallbacks.get(sid)?.(wire);
    } else {
      for (const cb of sessionEventCallbacks.values()) cb(wire);
    }
  });
```

(Note: `question_asked` carries `sessionId` after Task 3, so web routing works. Stdout is shared/global, which is correct for the single-TUI process.)

- [ ] **Step 5: Run the test + full suite**

Run (from `apps/core/`): `pnpm tsx --test src/server.test.ts` then `pnpm test`
Expected: PASS — new tests green, no regressions in the loop/instructions/compiler suites. (Pre-existing unrelated failures: `mcp/convert-tool.test.ts`, `session/manager.test.ts`, `session/store.test.ts` import a missing `vitest`; `memory/summarizer.test.ts` assertion drift. These are out of scope — do not fix here.)

- [ ] **Step 6: Commit** *(skip if user mandates no commits)*

```bash
git add apps/core/src/server.ts apps/core/src/server.test.ts
git commit -m "feat(core): bridge bus events to frontends and add question reply RPC"
```

---

### Task 5: TUI question picker + reply

**Files:**
- Modify: `apps/tui/src/ipc/client.ts`
- Create: `apps/tui/src/components/question-picker.ts`
- Modify: `apps/tui/src/index.ts`

**Interfaces:**
- Produces: `answerQuestion(requestId, answers)` / `rejectQuestion(requestId)` IPC senders; a `createQuestionPicker(question, callbacks, theme)` returning a `SelectList`; a `question_asked` case in `handleToolEvent` that mounts the picker and replies.

- [ ] **Step 1: Add IPC reply senders**

In `apps/tui/src/ipc/client.ts` (uses the existing `sendRequest` helper):

```ts
export async function answerQuestion(
  requestId: string,
  answers: string[],
): Promise<void> {
  await sendRequest("question.answer", { requestId, answers });
}

export async function rejectQuestion(requestId: string): Promise<void> {
  await sendRequest("question.reject", { requestId });
}
```

- [ ] **Step 2: Create the picker component**

Create `apps/tui/src/components/question-picker.ts`, modeled on `components/model-picker.ts` (`SelectList` + `SelectItem`). v1 renders **one** question's options; `onSelect` returns the chosen `label`.

```ts
import { SelectList, type SelectItem, type SelectListTheme } from "@earendil-works/pi-tui";
import type { QuestionSpec } from "@thisisayande/freecode-shared";

export function createQuestionPicker(
  question: QuestionSpec,
  callbacks: { onSelect: (label: string) => void; onCancel: () => void },
  theme: SelectListTheme,
): SelectList {
  const items: SelectItem[] = question.options.map((o) => ({
    label: o.label,
    value: o.label, // answers are matched by label (see question tool output)
    description: o.description,
  }));
  const selector = new SelectList(items, Math.min(items.length, 5), theme);
  selector.onSelect = async (item: SelectItem) => callbacks.onSelect(item.value);
  selector.onCancel = () => callbacks.onCancel();
  return selector;
}
```

- [ ] **Step 3: Handle `question_asked` in the TUI**

In `apps/tui/src/index.ts`, import `createQuestionPicker`, `answerQuestion`, `rejectQuestion`, and add a `case "question_asked":` to `handleToolEvent` (mirrors how `showModelSelector` mounts a `SelectList` at `index.ts:293-296`). For a multi-question payload, render sequentially, accumulating an `answers: string[]` indexed by question; send once the last is answered. On cancel, call `rejectQuestion(requestId)`.

```ts
    case "question_asked": {
      const answers: string[] = [];
      const askAt = (i: number) => {
        const q = event.questions[i];
        const picker = createQuestionPicker(
          q,
          {
            onSelect: (label) => {
              answers[i] = label;
              removeSelector(picker);
              if (i + 1 < event.questions.length) askAt(i + 1);
              else { void answerQuestion(event.requestId, answers); tui.setFocus(editor); }
              tui.requestRender();
            },
            onCancel: () => {
              removeSelector(picker);
              void rejectQuestion(event.requestId);
              tui.setFocus(editor);
              tui.requestRender();
            },
          },
          defaultSelectListTheme,
        );
        const editorIdx = tui.children.indexOf(editor);
        tui.children.splice(editorIdx + 1, 0, picker);
        tui.setFocus(picker);
        tui.requestRender();
      };
      askAt(0);
      break;
    }
```

- [ ] **Step 4: Typecheck the TUI**

Run (from repo root): `pnpm --filter @thisisayande/freecode-tui exec tsc --noEmit`
Expected: exit 0. (Interactive rendering is verified manually in the section below — no unit test for the `SelectList` mount.)

- [ ] **Step 5: Commit** *(skip if user mandates no commits)*

```bash
git add apps/tui/src/ipc/client.ts apps/tui/src/components/question-picker.ts apps/tui/src/index.ts
git commit -m "feat(tui): render agent questions and reply over IPC"
```

---

## Manual verification (after all tasks)

**This is required — it validates the load-bearing concurrency assumption (Background gap #2).**

1. Build core: `pnpm --filter @thisisayande/freecode-core build`.
2. Start the TUI (`pnpm --filter @thisisayande/freecode-tui dev`) in a project.
3. Send a prompt that makes the agent ask, e.g. *"Ask me whether to use tabs or spaces before proceeding."*
4. Confirm: a `SelectList` of options appears in the TUI **mid-turn** (not after the turn ends).
5. Choose an option. Confirm the agent **continues** using the answer (the `question` tool returns `"User has answered..."`, not a timeout error).
6. Repeat and press Esc/cancel instead — confirm the tool reports rejection and the agent proceeds without hanging.
7. If the picker never appears or the turn deadlocks: the stdin loop is serializing the reply behind the parked `session.send`. Fix by making `startServer`'s stdin handler dispatch `handleRequest` **without awaiting in the for-loop** (fire-and-forget per line, preserving output ordering by id) — see Notes.

## Notes / deferred (do NOT implement now)

- **Concurrency fallback:** if Task 5 manual step 7 deadlocks, change `server.ts:562-572` so each line's `handleRequest(...).then(write)` is not `await`ed inside the `for` loop. This lets a parked `session.send` coexist with an incoming `question.answer`. Only do this if the manual test proves it necessary — it is a behavioral change to request handling.
- **Web-app question UI** — the web frontend receives `question_asked` over SSE and can already POST `question.answer`, but building its React picker is out of scope here.
- **Multi-select questions** (`multiple: true`) and **free-text custom answers** (`custom: true`) — v1 renders single-select option lists only. `SelectList` is single-select; multi-select + text entry are deferred.
- **Bespoke TUI rendering for `subagent.*` / `mcp.server.*` / `session.diff`** — these events now reach the TUI but are ignored (no `default` case). Dedicated panels are a separate phase.
- **Removing the redundant bus tool events** — `tool.called`/`tool.completed` are published on the bus *and* streamed via `onToolEvent`. The bridge forwards the bus copies too; if the TUI double-renders tools, add `tool.called`/`tool.completed` to `INTERNAL_ONLY` in `bridge.ts`. Check during manual verification.
