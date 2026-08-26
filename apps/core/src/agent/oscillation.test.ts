import test from "node:test";
import assert from "node:assert/strict";
import {
  recordEdit,
  countReverts,
  toEditTransition,
  RECENT_EDIT_WINDOW,
  type RecordedEdit,
} from "./oscillation.js";
import { createAgentLoop } from "./loop.js";
import { createLoopHealthEvaluator } from "../effect/loop-health.js";
import type { ToolCall, ToolResult } from "./types.js";

// A rolling window that mirrors how the loop records edits.
class Window {
  edits: RecordedEdit[] = [];
  record(file: string, oldString: string, newString: string): boolean {
    this.edits = recordEdit(
      this.edits,
      toEditTransition(file, oldString, newString),
    );
    return this.edits[this.edits.length - 1].reverted;
  }
  get score(): number {
    return countReverts(this.edits);
  }
}

test("building one file up over many edits is never a revert", () => {
  const w = new Window();
  // The regression: a long task legitimately edits one file dozens of times.
  for (let i = 0; i < 40; i++) {
    w.record("MainActivity.kt", `state ${i}`, `state ${i + 1}`);
  }
  assert.equal(w.score, 0);
});

test("an edit that undoes an earlier one is a revert", () => {
  const w = new Window();
  assert.equal(w.record("a.ts", "X", "Y"), false);
  assert.equal(w.record("a.ts", "Y", "X"), true);
});

test("edit/revert/edit scores twice", () => {
  const w = new Window();
  for (const [from, to] of [
    ["X", "Y"],
    ["Y", "X"],
    ["X", "Y"],
  ]) {
    w.record("a.ts", from, to);
  }
  assert.equal(w.score, 2);
});

test("the same transition on a different file is not a revert", () => {
  const w = new Window();
  w.record("a.ts", "X", "Y");
  assert.equal(w.record("b.ts", "Y", "X"), false);
});

test("a no-op edit is not a revert", () => {
  const w = new Window();
  w.record("a.ts", "X", "X");
  assert.equal(w.record("a.ts", "X", "X"), false);
});

test("an inverse older than the window is forgotten", () => {
  const w = new Window();
  w.record("a.ts", "X", "Y");
  for (let i = 0; i < RECENT_EDIT_WINDOW; i++) {
    w.record("other.ts", `p${i}`, `q${i}`);
  }
  assert.equal(w.record("a.ts", "Y", "X"), false);
});

test("an edit/revert pair ages out of the window and the score falls", () => {
  const w = new Window();
  w.record("a.ts", "X", "Y");
  assert.equal(w.record("a.ts", "Y", "X"), true);
  assert.equal(w.score, 1);
  // Forward progress elsewhere pushes the scored pair out of the window. The
  // old running counter stayed armed here for the rest of the run.
  for (let i = 0; i < RECENT_EDIT_WINDOW; i++) {
    w.record("other.ts", `p${i}`, `q${i}`);
  }
  assert.equal(w.score, 0);
});

// -----------------------------------------------------------------------------
// Loop-level wiring: private members reached via `as any`, matching the
// existing agent loop tests.
// -----------------------------------------------------------------------------

function applyEdit(
  loop: unknown,
  file: string,
  oldString: string,
  newString: string,
): void {
  const call: ToolCall = {
    id: `call-${Math.random()}`,
    tool: "edit",
    args: { filePath: file, oldString, newString },
    execution: "sequential",
  };
  const result = {
    id: "r",
    toolCallId: call.id,
    tool: "edit",
    title: "edit",
  } as ToolResult;
  (loop as any).updateLoopHealth(call, result);
}

// The loop's own health check, run against its live state.
function health(loop: unknown) {
  return createLoopHealthEvaluator().evaluate(
    (loop as any).state,
    (loop as any).config.heuristics,
  );
}

test("a long run of forward edits to one file does not stop the loop", () => {
  const loop = createAgentLoop("test-oscillation-forward");
  // Well past the old detector's limit, which stopped after ~10 same-file edits.
  for (let i = 0; i < 40; i++) {
    applyEdit(loop, "/p/MainActivity.kt", `state ${i}`, `state ${i + 1}`);
  }
  assert.equal((loop as any).state.loopHealth.oscillationScore, 0);
  assert.equal(health(loop).action, "continue");
});

test("a genuine revert cycle still stops the loop", () => {
  const loop = createAgentLoop("test-oscillation-revert");
  // Distinct content each cycle so the repeated-identical-tool detector, which
  // keys on tool+args, stays out of it and oscillation is what trips.
  for (let i = 0; i < 8; i++) {
    applyEdit(loop, "/p/a.ts", `A${i}`, `B${i}`);
    applyEdit(loop, "/p/a.ts", `B${i}`, `A${i}`);
  }
  const action = health(loop);
  assert.equal(action.action, "stop");
  assert.equal(action.reason, "oscillation_detected");
});

test("a failed edit does not count toward oscillation", () => {
  const loop = createAgentLoop("test-oscillation-failed");
  const call: ToolCall = {
    id: "c1",
    tool: "edit",
    args: { filePath: "/p/a.ts", oldString: "X", newString: "Y" },
    execution: "sequential",
  };
  (loop as any).updateLoopHealth(call, {
    id: "r",
    toolCallId: "c1",
    tool: "edit",
    title: "edit",
    error: "oldString not found",
  } as ToolResult);
  applyEdit(loop, "/p/a.ts", "Y", "X");
  assert.equal((loop as any).state.loopHealth.oscillationScore, 0);
});
