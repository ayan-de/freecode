import test from "node:test";
import assert from "node:assert/strict";
import {
  TodoWriteTool,
  getTodos,
  clearTodos,
  renderTodoPromptBlock,
  type TodoItem,
} from "./todo.js";

const ctx = (sessionId: string) => ({
  cwd: "/tmp",
  sessionId,
  abort: new AbortController().signal,
});

test("renderTodoPromptBlock returns empty string when no list exists", () => {
  clearTodos("todo-empty");
  assert.equal(renderTodoPromptBlock("todo-empty"), "");
});

test("renderTodoPromptBlock renders status marks and persists via the store", async () => {
  const sessionId = "todo-render";
  clearTodos(sessionId);

  const todos: TodoItem[] = [
    { id: "1", content: "Port tree-sitter queries", status: "completed" },
    { id: "2", content: "Wire repo-map into compiler", status: "in_progress" },
    { id: "3", content: "Add fixture test", status: "pending" },
  ];

  await TodoWriteTool.execute({ todos }, ctx(sessionId));

  // Store is the single source of truth the prompt block reads from.
  assert.equal(getTodos(sessionId).length, 3);

  const block = renderTodoPromptBlock(sessionId);
  assert.match(block, /## Current Task List/);
  assert.match(block, /survives context compaction|persists across context compaction/);
  assert.match(block, /\[x\] Port tree-sitter queries/);
  assert.match(block, /\[~\] Wire repo-map into compiler/);
  assert.match(block, /\[ \] Add fixture test/);
});
