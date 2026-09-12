import test from "node:test";
import assert from "node:assert/strict";
import { aggregate, foldSession, type RawEvent } from "./fold.js";

let t = 1_000;
const ev = (e: Omit<RawEvent, "timestamp">): RawEvent => ({ ...e, timestamp: (t += 1000) });
const todo = (todos: unknown[]) => ev({ type: "function.call", tool: "todowrite", args: { todos } });

test("a session with no todo list and no pokes folds to nothing", () => {
  assert.equal(foldSession([ev({ type: "function.call", tool: "ls", args: {} })]), undefined);
});

test("confidence at assignment and at completion pair up per item", () => {
  const s = foldSession([
    todo([
      { id: "a", status: "in_progress", confidence: 30 },
      { id: "b", status: "pending", confidence: 60 },
      { id: "c", status: "pending" },
    ]),
    todo([
      { id: "a", status: "completed", confidence: 95 },
      { id: "b", status: "in_progress", confidence: 70 },
      { id: "c", status: "pending" },
    ]),
    ev({ type: "todo.signal", kind: "confidence_spike", itemId: "a", from: 30, to: 95, gated: true }),
    todo([
      { id: "a", status: "completed", confidence: 100 },
      { id: "b", status: "completed", confidence: 85 },
      { id: "c", status: "completed", confidence: 100 },
    ]),
  ])!;
  assert.deepEqual(
    s.trajectories.map((x) => [x.assigned, x.completed, x.spike, x.gated]),
    [
      [30, 95, false, false], // signal arrives after the call that completed it…
      [60, 85, false, false],
    ],
  );
  assert.equal(s.itemsCompleted, 3, "c completed too, just with no number to pair");
  assert.equal(s.finalOpen, 0);
  assert.equal(s.finalTotal, 3);
  assert.deepEqual(s.spikes, { n: 1, gated: 1 });
});

test("a spike signal recorded BEFORE the completing call marks the trajectory", () => {
  // The loop records the signal after diffing the call, so in the real log the
  // call comes first; the signal still refers to it. Either order must work
  // for the count, and the trajectory picks up the flag when it precedes.
  const s = foldSession([
    todo([{ id: "a", status: "pending", confidence: 20 }]),
    ev({ type: "todo.signal", kind: "confidence_spike", itemId: "a", from: 20, to: 100, gated: false }),
    todo([{ id: "a", status: "completed", confidence: 100 }]),
  ])!;
  assert.deepEqual(s.trajectories, [{ assigned: 20, completed: 100, spike: true, gated: false }]);
});

test("every hill-climb rating counts, including a re-rating of the same item", () => {
  const s = foldSession([
    todo([{ id: "a", status: "pending", hillClimbability: 55 }, { id: "b", status: "pending", hillClimbability: "95" }]),
    todo([{ id: "a", status: "in_progress", hillClimbability: 90 }, { id: "b", status: "pending", hillClimbability: 95 }]),
    ev({ type: "todo.signal", kind: "hill_climb_low", itemId: "a", to: 55, gated: true }),
  ])!;
  assert.deepEqual(s.hillClimb, [55, 95, 90, 95]);
  assert.deepEqual(s.hillClimbLow, { n: 1, gated: 1 });
});

test("pokes: productive means a tool call followed, and completions after a poke are counted", () => {
  const s = foldSession([
    todo([{ id: "a", status: "completed" }, { id: "b", status: "pending" }, { id: "c", status: "pending" }]),
    ev({ type: "poke.triggered", pokeIndex: 1, remaining: 2 }),
    ev({ type: "function.call", tool: "bash", args: {} }),
    todo([{ id: "a", status: "completed" }, { id: "b", status: "completed" }, { id: "c", status: "pending" }]),
    ev({ type: "poke.triggered", pokeIndex: 2, remaining: 1 }),
    ev({ type: "poke.skipped", reason: "no_progress", remaining: 1 }),
  ])!;
  assert.equal(s.pokes.triggered, 2);
  assert.equal(s.pokes.productive, 1, "the second poke was never followed by a call");
  assert.equal(s.pokes.itemsCompletedAfterPoke, 1);
  assert.deepEqual(s.pokes.skipped, { no_progress: 1 });
  assert.equal(s.finalOpen, 1);
});

test("a pre-gate session still yields the ended-open baseline", () => {
  const s = foldSession([
    todo([{ id: "a", status: "in_progress" }, { id: "b", status: "pending" }]),
    todo([{ id: "a", status: "completed" }, { id: "b", status: "pending" }]),
  ])!;
  assert.equal(s.finalOpen, 1);
  assert.equal(s.pokes.triggered, 0);
  assert.deepEqual(s.pokes.skipped, {});
});

test("aggregate splits the ended-open rate by whether the gate was on", () => {
  const off = foldSession([
    todo([{ id: "a", status: "pending", hillClimbability: 50 }]),
    ev({ type: "poke.skipped", reason: "disabled", remaining: 1 }),
  ])!;
  const on = foldSession([
    todo([{ id: "a", status: "pending", hillClimbability: 100 }]),
    ev({ type: "poke.triggered", pokeIndex: 1, remaining: 1 }),
    ev({ type: "function.call", tool: "edit", args: {} }),
    todo([{ id: "a", status: "completed" }]),
    ev({ type: "poke.skipped", reason: "nothing_open", remaining: 0 }),
  ])!;
  const r = aggregate([off, on], 5, new Date("2026-09-12T00:00:00Z"));
  assert.equal(r.sessionsScanned, 5);
  assert.equal(r.sessionsWithTodos, 2);
  assert.equal(r.autoPoke.gatedSessions, 1);
  assert.deepEqual(r.autoPoke.endedOpenByGate, { on: { n: 1, open: 0 }, off: { n: 1, open: 1 } });
  assert.equal(r.autoPoke.pokes, 1);
  assert.equal(r.autoPoke.productiveRate, 1);
  assert.equal(r.autoPoke.itemsCompletedAfterPoke, 1);
  assert.deepEqual(r.autoPoke.skipped, { disabled: 1, nothing_open: 1 });
  assert.equal(r.autoPoke.stopsConsidered, 3);
  assert.deepEqual(r.hillClimb.histogram, { "50": 1, "100": 1 });
  assert.equal(r.hillClimb.belowGate, 1);
  assert.equal(r.hillClimb.median, 75);
  assert.deepEqual(r.hillClimb.range, [50, 100]);
  assert.equal(r.confidence.n, 0);
  assert.equal(r.confidence.assignedMean, null);
});

test("empty input aggregates to nulls, never zeros dressed as rates", () => {
  const r = aggregate([], 0);
  assert.equal(r.autoPoke.endedOpenRate, null);
  assert.equal(r.autoPoke.productiveRate, null);
  assert.equal(r.hillClimb.belowGateRate, null);
  assert.equal(r.hillClimb.mean, null);
  assert.equal(r.window.from, null);
});
