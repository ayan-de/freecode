import test from "node:test";
import assert from "node:assert/strict";
import {
  shouldNudgeTodo,
  todoNudgeReminder,
  TODO_NUDGE_TURNS,
  TODO_NUDGE_GAP,
} from "./reminders.js";
test("nudge respects the turn threshold and inter-nudge gap", () => {
  // Not enough idle turns yet.
  assert.equal(shouldNudgeTodo(TODO_NUDGE_TURNS - 1, TODO_NUDGE_GAP), false);
  // Idle long enough and gap satisfied.
  assert.equal(shouldNudgeTodo(TODO_NUDGE_TURNS, TODO_NUDGE_GAP), true);
  // Idle long enough but nudged too recently.
  assert.equal(shouldNudgeTodo(TODO_NUDGE_TURNS, TODO_NUDGE_GAP - 1), false);
});

test("nudge text is a system-reminder that mentions todowrite", () => {
  assert.match(todoNudgeReminder(), /<system-reminder>/);
  assert.match(todoNudgeReminder(), /todowrite/);
});
