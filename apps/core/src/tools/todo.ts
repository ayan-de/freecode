// =============================================================================
// TodoWrite Tool - Maintain a structured task checklist for the current session
// State is kept in-memory keyed by sessionId. Each call replaces the full list.
// =============================================================================

import type { ToolContext } from "./types.js";
import type { Tool, ToolExecutionResult, JsonSchema } from "./tool.types.js";
import { buildTool, defaultToolUI } from "./factory.js";
import { todoToolUI } from "./todo/ui.js";

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

// Per-session store. Other modules can read via getTodos().
const store = new Map<string, TodoItem[]>();

export function getTodos(sessionId: string): TodoItem[] {
  return store.get(sessionId) ?? [];
}

export function clearTodos(sessionId: string): void {
  store.delete(sessionId);
}

const todoSchema: JsonSchema = {
  type: "object",
  properties: {
    todos: {
      description:
        "The full, updated todo list. Each item: { id, content, status } where status is 'pending', 'in_progress', or 'completed'. Keep exactly one item 'in_progress' at a time.",
      type: "array",
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
    return { valid: false, error: "todos must be an array" };
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
  description:
    "Create and update a structured task list for the current session. Use it to plan multi-step work and track progress; call it again with the full updated list whenever a task's status changes.",
  schemas: { parameters: todoSchema },
  permissions: { operations: [] },
  behavior: {
    isConcurrencySafe: false,
    isDestructive: false,
    userFacingName: "TodoWrite",
  },
  ui: { ...defaultToolUI, ...todoToolUI },
  execute: executeTodoWrite,
  validateInput: validateTodoInput,
  isSearchOrReadCommand: () => ({ isSearch: false, isRead: false }),
});
