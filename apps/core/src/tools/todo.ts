// =============================================================================
// TodoWrite Tool - Maintain a structured task checklist for the current session
// State is kept in-memory keyed by sessionId. Each call replaces the full list.
// =============================================================================

import type { ToolContext } from "./types.js";
import type { Tool, ToolExecutionResult, JsonSchema } from "./tool.types.js";
import { buildTool } from "./factory.js";

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

// Render the session's active todo list as a system-prompt block. Re-built from
// the store every turn (not from history), so the plan survives context
// compaction. Returns "" when there is no list so the loop can skip the block.
export function renderTodoPromptBlock(sessionId: string): string {
  const todos = getTodos(sessionId);
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
      "context compaction — treat it as the source of truth for remaining work, " +
      "and keep it updated with todowrite as tasks change status.",
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
  execute: executeTodoWrite,
  validateInput: validateTodoInput,
  isSearchOrReadCommand: () => ({ isSearch: false, isRead: false }),
});
