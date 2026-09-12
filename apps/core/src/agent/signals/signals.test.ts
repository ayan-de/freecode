import test from "node:test";
import assert from "node:assert/strict";
import type { TodoItem } from "../../tools/todo.js";
import { resolveSignalSettings, DEFAULT_SIGNAL_SETTINGS } from "./settings.js";
import { diffTodoSignals } from "./todo-signals.js";
import { decidePoke, initialPokeState, notePoke, todoFingerprint } from "./auto-poke.js";

const item = (o: Partial<TodoItem> & { id: string }): TodoItem => ({
  content: `task ${o.id}`,
  status: "pending",
  ...o,
});

// --- settings ---------------------------------------------------------------

test("every gate is off by default", () => {
  const s = resolveSignalSettings([], {});
  assert.equal(s.autoPoke.enabled, false);
  assert.equal(s.confidenceGate.enabled, false);
  assert.equal(s.hillClimbGate.enabled, false);
  assert.deepEqual(s, DEFAULT_SIGNAL_SETTINGS);
});

test("project scope beats user scope beats default", () => {
  const s = resolveSignalSettings(
    [{ autoPoke: { maxPerRun: 1 } }, { autoPoke: { enabled: true, maxPerRun: 9 } }],
    {},
  );
  assert.equal(s.autoPoke.enabled, true, "user scope fills what project left unset");
  assert.equal(s.autoPoke.maxPerRun, 1, "project scope wins where it speaks");
});

test("env flag beats both files, in either direction", () => {
  const on = resolveSignalSettings([{ autoPoke: { enabled: false } }], {
    FREECODE_AUTO_POKE: "1",
  });
  assert.equal(on.autoPoke.enabled, true);
  const off = resolveSignalSettings([{ confidenceGate: { enabled: true } }], {
    FREECODE_CONFIDENCE_GATE: "0",
  });
  assert.equal(off.confidenceGate.enabled, false);
  // Garbage in the env is "unset", not "on".
  const junk = resolveSignalSettings([], { FREECODE_HILLCLIMB_GATE: "maybe" });
  assert.equal(junk.hillClimbGate.enabled, false);
});

// --- todo signals -----------------------------------------------------------

test("a completion that jumps confidence by the spike or more is a signal", () => {
  const prev = [item({ id: "a", status: "in_progress", confidence: 40 })];
  const next = [item({ id: "a", status: "completed", confidence: 95 })];
  const sig = diffTodoSignals(prev, next, { spike: 40, threshold: 90 });
  assert.deepEqual(sig, [
    { kind: "confidence_spike", itemId: "a", content: "task a", from: 40, to: 95 },
  ]);
});

test("stepping up gradually is not a spike", () => {
  const prev = [item({ id: "a", status: "in_progress", confidence: 70 })];
  const next = [item({ id: "a", status: "completed", confidence: 95 })];
  assert.deepEqual(diffTodoSignals(prev, next, { spike: 40, threshold: 90 }), []);
});

test("a spike needs a completion — revising confidence mid-flight is fine", () => {
  const prev = [item({ id: "a", status: "in_progress", confidence: 20 })];
  const next = [item({ id: "a", status: "in_progress", confidence: 90 })];
  assert.deepEqual(diffTodoSignals(prev, next, { spike: 40, threshold: 90 }), []);
});

test("an item with no prior number cannot spike", () => {
  const prev = [item({ id: "a", status: "in_progress" })];
  const next = [item({ id: "a", status: "completed", confidence: 100 })];
  assert.deepEqual(diffTodoSignals(prev, next, { spike: 40, threshold: 90 }), []);
});

test("a low hill-climb rating fires once per rating, not per call", () => {
  const first = diffTodoSignals([], [item({ id: "a", hillClimbability: 55 })], {
    spike: 40,
    threshold: 90,
  });
  assert.equal(first.length, 1);
  assert.equal(first[0]!.kind, "hill_climb_low");
  // Same rating re-sent: silence.
  const again = diffTodoSignals(
    [item({ id: "a", hillClimbability: 55 })],
    [item({ id: "a", hillClimbability: 55, status: "in_progress" })],
    { spike: 40, threshold: 90 },
  );
  assert.deepEqual(again, []);
  // Re-rated, still low: fires again.
  const rerated = diffTodoSignals(
    [item({ id: "a", hillClimbability: 55 })],
    [item({ id: "a", hillClimbability: 60 })],
    { spike: 40, threshold: 90 },
  );
  assert.equal(rerated.length, 1);
});

test("a completed item is never asked to reframe", () => {
  const sig = diffTodoSignals(
    [],
    [item({ id: "a", status: "completed", hillClimbability: 10 })],
    { spike: 40, threshold: 90 },
  );
  assert.deepEqual(sig, []);
});

// --- auto-poke --------------------------------------------------------------

const open = [item({ id: "1", status: "completed" }), item({ id: "2", status: "pending" })];

test("disabled is the reason even when nothing is open", () => {
  const d = decidePoke({ enabled: false, maxPerRun: 3, todos: [], state: initialPokeState() });
  assert.deepEqual(d, { poke: false, skip: "disabled" });
});

test("an all-completed list, or no list, never pokes", () => {
  const done = [item({ id: "1", status: "completed" })];
  assert.deepEqual(
    decidePoke({ enabled: true, maxPerRun: 3, todos: done, state: initialPokeState() }),
    { poke: false, skip: "nothing_open" },
  );
  assert.deepEqual(
    decidePoke({ enabled: true, maxPerRun: 3, todos: [], state: initialPokeState() }),
    { poke: false, skip: "nothing_open" },
  );
});

test("pokes while items are open, up to the cap", () => {
  let state = initialPokeState();
  const first = decidePoke({ enabled: true, maxPerRun: 2, todos: open, state });
  assert.equal(first.poke, true);
  if (!first.poke) return;
  assert.equal(first.remaining.length, 1);
  state = notePoke(state, first.fingerprint);

  // The model made progress (list changed) — poke again.
  const moved = [item({ id: "2", status: "in_progress" }), item({ id: "3" })];
  const second = decidePoke({ enabled: true, maxPerRun: 2, todos: moved, state });
  assert.equal(second.poke, true);
  if (!second.poke) return;
  state = notePoke(state, second.fingerprint);

  const third = decidePoke({ enabled: true, maxPerRun: 2, todos: [item({ id: "9" })], state });
  assert.deepEqual(third, { poke: false, skip: "cap_reached" });
});

test("an unchanged list after a poke is no progress, and stops the run", () => {
  const state = notePoke(initialPokeState(), todoFingerprint(open));
  const d = decidePoke({ enabled: true, maxPerRun: 3, todos: open, state });
  assert.deepEqual(d, { poke: false, skip: "no_progress" });
});

test("the fingerprint ignores completed items, so finishing one is progress", () => {
  const a = [item({ id: "1" }), item({ id: "2" })];
  const b = [item({ id: "1", status: "completed" }), item({ id: "2" })];
  assert.notEqual(todoFingerprint(a), todoFingerprint(b));
  const c = [item({ id: "2" })];
  assert.equal(todoFingerprint(b), todoFingerprint(c));
});
