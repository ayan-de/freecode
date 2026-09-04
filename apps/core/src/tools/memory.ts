// =============================================================================
// Memory Tool - Persist durable facts across sessions.
// Writes go through MemoryStore (never raw fs) so frontmatter, the MEMORY.md
// index, and the derived knowledge graph stay consistent by construction
// (spec 2026-08-09-memory-write-path.md, D1).
// =============================================================================

import type { ToolContext } from "./types.js";
import type { Tool, ToolExecutionResult, JsonSchema } from "./tool.types.js";
import { buildTool } from "./factory.js";
import { getMemoryStore } from "../memory/mem-store.js";
import {
  AUTHORABLE_MEMORY_TYPES,
  MEMORY_TYPES,
  type MemoryType,
} from "../memory/mem-types.js";
import { containsSecret } from "../memory/graph/secret-filter.js";

type Action = "save" | "delete" | "list";

interface MemoryParams {
  action: Action;
  type?: MemoryType;
  name?: string;
  description?: string;
  content?: string;
  tags?: string[];
  supersedes?: string[];
}

const ACTIONS: Action[] = ["save", "delete", "list"];
const TYPE_LIST = AUTHORABLE_MEMORY_TYPES.join(", ");

// Providers with strict schema decoding send lists as comma-separated strings
// (see the tool checklist in CLAUDE.md), so coerce rather than reject.
function toList(value: unknown): string[] | undefined {
  const items = Array.isArray(value)
    ? value.map((v) => String(v))
    : typeof value === "string"
      ? value.split(",")
      : [];
  const out = items.map((s) => s.trim()).filter((s) => s.length > 0);
  return out.length > 0 ? out : undefined;
}

const memorySchema: JsonSchema = {
  type: "object",
  properties: {
    action: {
      type: "string",
      enum: ACTIONS,
      description:
        "'save' to create or update a memory, 'delete' to remove one, 'list' to see what is already stored (names and descriptions only).",
    },
    type: {
      type: "string",
      enum: [...MEMORY_TYPES],
      description:
        "user = who they are/how they work; feedback = guidance they gave; project = non-derivable context (decisions, deadlines); reference = external pointers. 'episode' is machine-written — readable/deletable, not saveable.",
    },
    name: {
      type: "string",
      description:
        "Short kebab-case identifier. Saving with an existing name updates that memory.",
    },
    description: {
      type: "string",
      description:
        "One line describing what this memory holds. Used to judge relevance later, so be specific.",
    },
    content: {
      type: "string",
      description:
        "The memory itself. For feedback and project types, state the rule or fact then add **Why:** and **How to apply:** lines. Link related memories with [[their-name]].",
    },
    tags: {
      type: "array",
      items: { type: "string" },
      description: "Optional topic tags; they become edges in the memory graph.",
    },
    supersedes: {
      type: "array",
      items: { type: "string" },
      description:
        "Optional names of memories this one replaces, when the replacement has a different name.",
    },
  },
  required: ["action"],
};

function validateMemoryInput(
  params: unknown,
): { valid: true } | { valid: false; error: string } {
  if (!params || typeof params !== "object") {
    return { valid: false, error: "Expected object parameters" };
  }
  const p = params as Record<string, unknown>;

  const action = p.action;
  if (typeof action !== "string" || !ACTIONS.includes(action as Action)) {
    return {
      valid: false,
      error: `action must be one of ${ACTIONS.join(", ")}, received ${JSON.stringify(action)}`,
    };
  }

  if (action === "list") return { valid: true };

  const type = p.type;
  if (
    typeof type !== "string" ||
    !(MEMORY_TYPES as readonly string[]).includes(type)
  ) {
    return {
      valid: false,
      error: `type must be one of ${TYPE_LIST}, received ${JSON.stringify(type)}`,
    };
  }
  if (typeof p.name !== "string" || p.name.trim().length === 0) {
    return { valid: false, error: "name must be a non-empty string" };
  }
  if (action === "delete") return { valid: true };

  // Episodes are machine-written (spec D5). The model narrating its own session
  // into memory is the noise failure mode consolidation exists to prevent, so
  // `save` refuses the type while `list`, `delete`, and retrieval treat it
  // normally — the model can read its history, it just cannot author it.
  if (type === "episode") {
    return {
      valid: false,
      error: `episodes are written by consolidation, not saved directly. If this is durably true, save it as one of: ${TYPE_LIST}`,
    };
  }

  if (typeof p.description !== "string" || p.description.trim().length === 0) {
    return {
      valid: false,
      error:
        "description must be a non-empty string — it is what future retrieval matches against",
    };
  }
  if (typeof p.content !== "string" || p.content.trim().length === 0) {
    return { valid: false, error: "content must be a non-empty string" };
  }
  return { valid: true };
}

async function executeMemory(
  params: MemoryParams,
  ctx: ToolContext,
): Promise<
  ToolExecutionResult<{
    title: string;
    output: string;
    metadata?: Record<string, unknown>;
  }>
> {
  const store = getMemoryStore(ctx.projectPath ?? ctx.cwd);

  if (params.action === "list") {
    const entries = store.list(params.type);
    if (entries.length === 0) {
      return {
        success: true,
        result: { title: "No memories stored", output: "(no memories yet)" },
      };
    }
    // Descriptions only — bodies are what the graph surfaces on relevance.
    const lines = entries.map(
      (e) => `- ${e.type}/${e.name} — ${e.description}`,
    );
    return {
      success: true,
      result: {
        title: `${entries.length} memor${entries.length === 1 ? "y" : "ies"}`,
        output: lines.join("\n"),
        metadata: { count: entries.length },
      },
    };
  }

  const type = params.type as MemoryType;
  const name = (params.name as string).trim();

  if (params.action === "delete") {
    const deleted = store.delete(name, type);
    return {
      success: true,
      result: {
        title: deleted ? `Deleted ${type}/${name}` : `No such memory`,
        output: deleted
          ? `Deleted memory ${type}/${name}.`
          : `No memory named ${type}/${name} — nothing to delete.`,
        metadata: { deleted },
      },
    };
  }

  const description = (params.description as string).trim();
  const content = (params.content as string).trim();

  // Refuse credentials at write time, not just at embed time (D4). Without
  // this a secret is stored in plaintext and still reachable via the keyword
  // fallback, even though the graph declines to embed it.
  if (containsSecret(`${description}\n${content}`)) {
    return {
      success: false,
      error:
        "This looks like it contains a secret (API key, token, or private key). " +
        "Memories are stored in plaintext and injected into future prompts, so " +
        "credentials are never saved. Record where the credential lives instead " +
        "of the credential itself.",
    };
  }

  const existing = store.load(name, type);
  const now = Date.now();
  store.save({
    name,
    description,
    type,
    content,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    tags: toList(params.tags),
    supersedes: toList(params.supersedes),
  });

  const outcome = existing ? "updated" : "created";
  return {
    success: true,
    result: {
      title: `${outcome === "created" ? "Saved" : "Updated"} ${type}/${name}`,
      output: existing
        ? `Updated memory ${type}/${name}. It previously read: "${existing.description}"`
        : `Saved memory ${type}/${name}.`,
      metadata: {
        outcome,
        type,
        name,
        ...(existing ? { previousDescription: existing.description } : {}),
      },
    },
  };
}

export const MemoryTool: Tool<MemoryParams> = buildTool({
  id: "memory",
  description:
    "Store a durable fact about the user or project for future sessions — something still true " +
    "next week: a stated preference, a correction, a decision and its reasoning, an external pointer. " +
    "Never save what's derivable from code/git/project instructions or task details that expire with " +
    "the task. 'list' first if unsure — saving with an existing name updates it.",
  schemas: { parameters: memorySchema },
  permissions: { operations: ["file.write"] },
  behavior: {
    isConcurrencySafe: false,
    isDestructive: false,
    userFacingName: "Memory",
  },
  execute: executeMemory,
  validateInput: validateMemoryInput,
  isSearchOrReadCommand: () => ({ isSearch: false, isRead: false }),
});
