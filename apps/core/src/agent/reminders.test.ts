import test from "node:test";
import assert from "node:assert/strict";
import {
  evaluateTodoGate,
  shouldNudgeTodo,
  todoNudgeReminder,
  TODO_NUDGE_TURNS,
  TODO_NUDGE_GAP,
} from "./reminders.js";
import { TodoWriteTool, clearTodos, type TodoItem } from "../tools/todo.js";

const ctx = (sessionId: string) => ({
  cwd: "/tmp",
  sessionId,
  abort: new AbortController().signal,
});

async function setTodos(sessionId: string, todos: TodoItem[]) {
  await TodoWriteTool.execute({ todos }, ctx(sessionId));
}

test("todo gate does not fire when there is no list", () => {
  clearTodos("gate-none");
  assert.equal(evaluateTodoGate("gate-none").forceContinue, false);
});

test("todo gate does not fire when every item is completed", async () => {
  const s = "gate-done";
  clearTodos(s);
  await setTodos(s, [{ id: "1", content: "ship it", status: "completed" }]);
  assert.equal(evaluateTodoGate(s).forceContinue, false);
});

test("todo gate fires and lists unfinished items", async () => {
  const s = "gate-open";
  clearTodos(s);
  await setTodos(s, [
    { id: "1", content: "write parser", status: "completed" },
    { id: "2", content: "wire compiler", status: "in_progress" },
    { id: "3", content: "add test", status: "pending" },
  ]);
  const gate = evaluateTodoGate(s);
  assert.equal(gate.forceContinue, true);
  assert.match(gate.reminder ?? "", /wire compiler/);
  assert.match(gate.reminder ?? "", /add test/);
  assert.doesNotMatch(gate.reminder ?? "", /write parser/);
});

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
