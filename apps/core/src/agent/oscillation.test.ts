import test from "node:test";
import assert from "node:assert/strict";
import {
  isRevert,
  toEditTransition,
  RECENT_EDIT_WINDOW,
  type EditTransition,
} from "./oscillation.js";
import { createAgentLoop } from "./loop.js";
import type { ToolCall, ToolResult } from "./types.js";

// A rolling window that mirrors how the loop records edits.
function record(
  window: EditTransition[],
  file: string,
  oldString: string,
  newString: string,
): boolean {
  const edit = toEditTransition(file, oldString, newString);
  const reverted = isRevert(window, edit);
  window.push(edit);
  if (window.length > RECENT_EDIT_WINDOW) window.shift();
  return reverted;
}

test("building one file up over many edits is never a revert", () => {
  const window: EditTransition[] = [];
  let reverts = 0;
  // The regression: a long task legitimately edits one file dozens of times.
  for (let i = 0; i < 40; i++) {
    if (record(window, "MainActivity.kt", `state ${i}`, `state ${i + 1}`)) {
      reverts++;
    }
  }
  assert.equal(reverts, 0);
});

test("an edit that undoes an earlier one is a revert", () => {
  const window: EditTransition[] = [];
  assert.equal(record(window, "a.ts", "X", "Y"), false);
  assert.equal(record(window, "a.ts", "Y", "X"), true);
});

test("edit/revert/edit scores twice", () => {
  const window: EditTransition[] = [];
  let reverts = 0;
  for (const [from, to] of [
    ["X", "Y"],
    ["Y", "X"],
    ["X", "Y"],
  ]) {
    if (record(window, "a.ts", from, to)) reverts++;
  }
  assert.equal(reverts, 2);
});

test("the same transition on a different file is not a revert", () => {
  const window: EditTransition[] = [];
  record(window, "a.ts", "X", "Y");
  assert.equal(record(window, "b.ts", "Y", "X"), false);
});

test("a no-op edit is not a revert", () => {
  const window: EditTransition[] = [];
  record(window, "a.ts", "X", "X");
  assert.equal(record(window, "a.ts", "X", "X"), false);
});

test("an inverse older than the window is forgotten", () => {
  const window: EditTransition[] = [];
  record(window, "a.ts", "X", "Y");
  for (let i = 0; i < RECENT_EDIT_WINDOW; i++) {
    record(window, "other.ts", `p${i}`, `q${i}`);
  }
  assert.equal(record(window, "a.ts", "Y", "X"), false);
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

test("a long run of forward edits to one file does not stop the loop", () => {
  const loop = createAgentLoop("test-oscillation-forward");
  // Well past the old detector's limit, which stopped after ~10 same-file edits.
  for (let i = 0; i < 40; i++) {
    applyEdit(loop, "/p/MainActivity.kt", `state ${i}`, `state ${i + 1}`);
  }
  assert.equal((loop as any).state.loopHealth.oscillationScore, 0);
  assert.equal((loop as any).evaluateLoopHealth().action, "continue");
});

test("a genuine revert cycle still stops the loop", () => {
  const loop = createAgentLoop("test-oscillation-revert");
  // Distinct content each cycle so the repeated-identical-tool detector, which
  // keys on tool+args, stays out of it and oscillation is what trips.
  for (let i = 0; i < 8; i++) {
    applyEdit(loop, "/p/a.ts", `A${i}`, `B${i}`);
    applyEdit(loop, "/p/a.ts", `B${i}`, `A${i}`);
  }
  const action = (loop as any).evaluateLoopHealth();
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
