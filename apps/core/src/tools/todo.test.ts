import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "fs/promises";
import { readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { formatSessionDirName } from "../store/path-formatter.js";
import { createSessionStore } from "../session/store.js";
import {
  TodoWriteTool,
  getTodos,
  clearTodos,
  renderTodoPromptBlock,
  setTodoPersistenceBaseDir,
  resetTodoPersistenceBaseDir,
  type TodoItem,
} from "./todo.js";

const ctx = (sessionId: string, projectPath?: string) => ({
  cwd: projectPath ?? "/tmp",
  projectPath,
  sessionId,
  abort: new AbortController().signal,
});

const sampleTodos: TodoItem[] = [
  { id: "1", content: "Port tree-sitter queries", status: "completed" },
  { id: "2", content: "Wire repo-map into compiler", status: "in_progress" },
  { id: "3", content: "Add fixture test", status: "pending" },
];

let testHome: string;

before(async () => {
  testHome = await mkdtemp(join(tmpdir(), "freecode-todo-"));
  setTodoPersistenceBaseDir(testHome);
});

after(async () => {
  resetTodoPersistenceBaseDir();
  await rm(testHome, { recursive: true, force: true });
});

test("renderTodoPromptBlock returns empty string when no list exists", () => {
  clearTodos("todo-empty");
  assert.equal(renderTodoPromptBlock("todo-empty"), "");
});

test("renderTodoPromptBlock renders status marks and persists via the store", async () => {
  const sessionId = "todo-render";
  clearTodos(sessionId);

  await TodoWriteTool.execute({ todos: sampleTodos }, ctx(sessionId));

  // Store is the single source of truth the prompt block reads from.
  assert.equal(getTodos(sessionId).length, 3);

  const block = renderTodoPromptBlock(sessionId);
  assert.match(block, /## Current Task List/);
  assert.match(block, /persists across context compaction/);
  assert.match(block, /\[x\] Port tree-sitter queries/);
  assert.match(block, /\[~\] Wire repo-map into compiler/);
  assert.match(block, /\[ \] Add fixture test/);
});

test("todo list survives a process restart via todos.json", async () => {
  const projectPath = "/tmp/todo-persist-project";
  const sessionStore = await createSessionStore(testHome);
  const sessionId = await sessionStore.createSession({
    title: "Todo persist",
    projectPath,
    provider: "test",
  });

  await TodoWriteTool.execute(
    { todos: sampleTodos },
    ctx(sessionId, projectPath),
  );

  const onDisk = JSON.parse(
    readFileSync(
      join(
        testHome,
        "sessions",
        formatSessionDirName(projectPath),
        sessionId,
        "todos.json",
      ),
      "utf-8",
    ),
  ) as TodoItem[];
  assert.equal(onDisk.length, 3);

  // Simulate a new process: memory empty, disk intact.
  clearTodos(sessionId);
  assert.equal(getTodos(sessionId, projectPath).length, 3);
  const block = renderTodoPromptBlock(sessionId, projectPath);
  assert.match(block, /\[~\] Wire repo-map into compiler/);
});

test("todowrite without a session directory does not create one", async () => {
  clearTodos("no-session-dir");
  await TodoWriteTool.execute(
    { todos: sampleTodos },
    ctx("no-session-dir", "/tmp/does-not-have-a-session"),
  );
  clearTodos("no-session-dir");
  assert.equal(
    getTodos("no-session-dir", "/tmp/does-not-have-a-session").length,
    0,
  );
});
