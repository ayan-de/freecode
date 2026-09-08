// =============================================================================
// TodoWrite Tool - Maintain a structured task checklist for the current session
// Hot path is an in-memory Map keyed by sessionId. Each call replaces the
// full list. The same list is written to todos.json in the session directory
// so a process restart / session.resume still sees the plan.
// =============================================================================

import { existsSync, readFileSync, writeFileSync, readdirSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import type { ToolContext } from "./types.js";
import type { Tool, ToolExecutionResult, JsonSchema } from "./tool.types.js";
import { buildTool } from "./factory.js";
import { formatSessionDirName } from "../store/path-formatter.js";

export type TodoStatus = "pending" | "in_progress" | "completed";

export interface TodoItem {
  id: string;
  content: string;
  status: TodoStatus;
}

interface TodoWriteParams {
  todos: TodoItem[];
}

const STATUSES: TodoStatus[] = ["pending", "in_progress", "completed"];
const TODOS_FILE = "todos.json";

// Per-session cache. Disk is the source of truth after a restart; this Map
// avoids a read on every prompt render. Other modules can read via getTodos().
const store = new Map<string, TodoItem[]>();

// Same root SessionStore uses (`~/.freecode`). Tests point this at a tmpdir
// so they never write into the developer's real sessions tree.
let persistenceBaseDir = join(homedir(), ".freecode");

export function setTodoPersistenceBaseDir(dir: string): void {
  persistenceBaseDir = dir;
}

export function resetTodoPersistenceBaseDir(): void {
  persistenceBaseDir = join(homedir(), ".freecode");
}

function findSessionDir(
  sessionId: string,
  projectPath?: string,
): string | undefined {
  const sessionsRoot = join(persistenceBaseDir, "sessions");
  if (projectPath) {
    const dir = join(
      sessionsRoot,
      formatSessionDirName(projectPath),
      sessionId,
    );
    return existsSync(dir) ? dir : undefined;
  }
  if (!existsSync(sessionsRoot)) return undefined;
  try {
    for (const entry of readdirSync(sessionsRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const candidate = join(sessionsRoot, entry.name, sessionId);
      if (existsSync(candidate)) return candidate;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function parseTodos(raw: unknown): TodoItem[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const todos: TodoItem[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") return undefined;
    const t = item as Record<string, unknown>;
    if (typeof t.content !== "string" || t.content.length === 0) {
      return undefined;
    }
    if (typeof t.status !== "string" || !STATUSES.includes(t.status as TodoStatus)) {
      return undefined;
    }
    todos.push({
      id:
        typeof t.id === "string" && t.id.length > 0
          ? t.id
          : String(todos.length + 1),
      content: t.content,
      status: t.status as TodoStatus,
    });
  }
  return todos;
}

function loadFromDisk(
  sessionId: string,
  projectPath?: string,
): TodoItem[] | undefined {
  const dir = findSessionDir(sessionId, projectPath);
  if (!dir) return undefined;
  const path = join(dir, TODOS_FILE);
  if (!existsSync(path)) return undefined;
  try {
    return parseTodos(JSON.parse(readFileSync(path, "utf-8")));
  } catch {
    return undefined;
  }
}

function saveToDisk(
  sessionId: string,
  todos: TodoItem[],
  projectPath?: string,
): void {
  // Only write into an existing session directory — never mkdir a stray
  // session from a unit test that only passed a sessionId.
  const dir = findSessionDir(sessionId, projectPath);
  if (!dir) return;
  try {
    writeFileSync(join(dir, TODOS_FILE), JSON.stringify(todos), "utf-8");
  } catch {
    // Persistence is best-effort: a full disk must not fail the tool call.
  }
}

export function getTodos(sessionId: string, projectPath?: string): TodoItem[] {
  const cached = store.get(sessionId);
  if (cached) return cached;
  const disk = loadFromDisk(sessionId, projectPath);
  if (disk) {
    store.set(sessionId, disk);
    return disk;
  }
  return [];
}

// Drops the in-memory copy; the on-disk list survives.
export function clearTodos(sessionId: string): void {
  store.delete(sessionId);
}

// Render the session's active todo list as a system-prompt block. Re-built from
// the store every turn (not from history), so the plan survives context
// compaction and a session resume. Returns "" when there is no list so the
// loop can skip the block.
export function renderTodoPromptBlock(
  sessionId: string,
  projectPath?: string,
): string {
  const todos = getTodos(sessionId, projectPath);
  if (todos.length === 0) return "";
  const marks: Record<TodoStatus, string> = {
    completed: "[x]",
    in_progress: "[~]",
    pending: "[ ]",
  };
  const lines = todos.map((t) => `${marks[t.status]} ${t.content}`);
  return [
    "## Current Task List",
    "",
    "Your active plan (from the todowrite tool). This list persists across " +
      "context compaction and session resume — treat it as the source of truth " +
      "for remaining work, and keep it updated with todowrite as tasks change status.",
    "",
    ...lines,
  ].join("\n");
}

const todoSchema: JsonSchema = {
  type: "object",
  properties: {
    todos: {
      description:
        "The full, updated todo list. Keep exactly one item 'in_progress' at a time.",
      type: "array",
      // An array without `items` leaves providers that constrain decoding
      // against the schema with nothing to shape the elements with, so the
      // model occasionally emits a scalar or a non-JSON string instead of a
      // list. Spelling the item out is what keeps the call well-formed.
      items: {
        type: "object",
        properties: {
          id: { type: "string", description: "Stable identifier for the task." },
          content: { type: "string", description: "What the task is." },
          status: {
            type: "string",
            enum: STATUSES,
            description: "Current state of the task.",
          },
        },
        required: ["content", "status"],
      },
    },
  },
  required: ["todos"],
};

function validateTodoInput(
  params: unknown,
): { valid: true } | { valid: false; error: string } {
  if (!params || typeof params !== "object") {
    return { valid: false, error: "Expected object parameters" };
  }
  const raw = (params as Record<string, unknown>).todos;
  const list = typeof raw === "string" ? safeParse(raw) : raw;
  if (!Array.isArray(list)) {
    // Echo what arrived: a bare "must be an array" gives the model nothing to
    // correct against and it tends to retry the same malformed call.
    return {
      valid: false,
      error:
        `todos must be an array of { id, content, status } objects, received ` +
        `${JSON.stringify(raw)}. Resend the full list, e.g. ` +
        `{"todos":[{"id":"1","content":"...","status":"in_progress"}]}`,
    };
  }
  for (const item of list) {
    if (!item || typeof item !== "object") {
      return { valid: false, error: "each todo must be an object" };
    }
    const t = item as Record<string, unknown>;
    if (typeof t.content !== "string" || t.content.length === 0) {
      return { valid: false, error: "each todo needs a non-empty 'content' string" };
    }
    if (typeof t.status !== "string" || !STATUSES.includes(t.status as TodoStatus)) {
      return {
        valid: false,
        error: `each todo 'status' must be one of ${STATUSES.join(", ")}`,
      };
    }
  }
  return { valid: true };
}

function safeParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return undefined;
  }
}

function normalize(todos: TodoItem[]): TodoItem[] {
  return todos.map((t, i) => ({
    id: t.id && String(t.id).length > 0 ? String(t.id) : String(i + 1),
    content: t.content,
    status: t.status,
  }));
}

function render(todos: TodoItem[]): string {
  if (todos.length === 0) return "(todo list cleared)";
  const marks: Record<TodoStatus, string> = {
    completed: "[x]",
    in_progress: "[~]",
    pending: "[ ]",
  };
  return todos.map((t) => `${marks[t.status]} ${t.content}`).join("\n");
}

async function executeTodoWrite(
  params: TodoWriteParams,
  ctx: ToolContext,
): Promise<
  ToolExecutionResult<{
    title: string;
    output: string;
    metadata?: Record<string, unknown>;
  }>
> {
  const raw = params.todos as unknown;
  const parsed = (typeof raw === "string" ? safeParse(raw) : raw) as TodoItem[];
  const todos = normalize(parsed);

  const sessionId = ctx.sessionId ?? "default";
  store.set(sessionId, todos);
  saveToDisk(sessionId, todos, ctx.projectPath ?? ctx.cwd);

  const remaining = todos.filter((t) => t.status !== "completed").length;

  return {
    success: true,
    result: {
      title: `${remaining} todo${remaining === 1 ? "" : "s"} remaining`,
      output: render(todos),
      metadata: { todos, remaining, total: todos.length },
    },
  };
}

export const TodoWriteTool: Tool<TodoWriteParams> = buildTool({
  id: "todowrite",
  // Long on purpose. This is the tool whose "when" is hardest to get right —
  // claude-code spends 184 lines on it and opencode 44, because a one-line
  // description reliably produces a model that plans *after* it has already
  // explored, which is a plan that organised nothing. The ordering rule below
  // is the part that was missing.
  description: [
    "Create and maintain a structured task list for the session. Each call replaces the whole list.",
    "",
    "Use it when the work needs 3+ distinct steps, the user named several deliverables, asked for a plan, or new instructions arrive mid-task (capture before acting). Write the list BEFORE exploring — the plan frames the exploration. Do NOT use it for a single straightforward task or an informational question.",
    "",
    "States: pending, in_progress (exactly ONE at a time), completed. Mark items completed as you finish them — never batched at the end, only when genuinely done. If blocked, leave in_progress and add an item naming the blocker.",
  ].join("\n"),
  schemas: { parameters: todoSchema },
  permissions: { operations: [] },
  behavior: {
    isConcurrencySafe: false,
    isDestructive: false,
    userFacingName: "TodoWrite",
  },
  execute: executeTodoWrite,
  validateInput: validateTodoInput,
  isSearchOrReadCommand: () => ({ isSearch: false, isRead: false }),
});
