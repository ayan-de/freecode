// =============================================================================
// Memory Prompt - Build memory context for system prompts
// =============================================================================

import type { MemoryEntry, MemoryType } from "./mem-types.js";
import { MemoryStore } from "./mem-store.js";

export interface MemoryPromptOptions {
  types?: MemoryType[];
  limit?: number;
  all?: boolean; // opt in to the full, unbounded store
}

// Default cap so a caller that forgets `limit` can't dump the whole store into a
// prompt. Pass `all: true` (or an explicit `limit`) to override.
const DEFAULT_PROMPT_LIMIT = 25;

// Build a memory block (optionally type-filtered / capped). This is NOT
// relevance-ranked — it lists memories in the store's natural order. For
// relevance-based retrieval use the graph service (`memory.query` /
// MemoryGraphService.retrieve); do not route relevance through here.
export function buildMemoryPrompt(
  store: MemoryStore,
  options: MemoryPromptOptions = {},
): string {
  const { types, limit, all } = options;

  let entries: MemoryEntry[] = store.list();
  if (types && types.length > 0) {
    entries = entries.filter((e) => types.includes(e.type));
  }
  const effectiveLimit = limit ?? (all ? undefined : DEFAULT_PROMPT_LIMIT);
  if (effectiveLimit != null) {
    entries = entries.slice(0, effectiveLimit);
  }

  if (entries.length === 0) {
    return "";
  }

  const lines: string[] = [
    "# Memory",
    "",
    `You have a persistent, file-based memory system at \`${store.getMemoryDir()}\`. This directory already exists — write to it directly (do not run mkdir).`,
    "",
    "## Types of memory",
    "- **user**: User's role, goals, preferences, knowledge",
    "- **feedback**: Guidance on what to avoid/repeat. Structure as: rule/fact, then **Why:** and **How to apply:** lines",
    "- **project**: Non-derivabl context: deadlines, decisions, who's doing what",
    "- **reference**: External system pointers (Linear, Grafana, Slack)",
    "",
    "## What NOT to save in memory",
    "- Code patterns, git history, architecture (derivable from code)",
    "- Debugging solutions (the fix is in the code)",
    "- CLAUDE.md content, ephemeral task details",
    "",
    "## When to access memories",
    "- When memories seem relevant or user references prior work",
    "- MUST access when user asks to check/recall/remember",
    "- If user says *ignore* memory: treat MEMORY.md as empty",
    "",
    "## Before recommending from memory",
    "Verify file paths exist, grep for function/flag names before citing them",
    "",
    "---",
    "",
  ];

  // Group by type
  const byType = new Map<MemoryType, MemoryEntry[]>();
  for (const entry of entries) {
    const list = byType.get(entry.type) ?? [];
    list.push(entry);
    byType.set(entry.type, list);
  }

  for (const type of [
    "user",
    "feedback",
    "project",
    "reference",
  ] as MemoryType[]) {
    const typeEntries = byType.get(type) ?? [];
    if (typeEntries.length === 0) continue;

    lines.push(`## ${type.charAt(0).toUpperCase() + type.slice(1)}`);
    for (const entry of typeEntries) {
      lines.push("");
      lines.push(`### ${entry.name}`);
      lines.push(entry.content);
    }
    lines.push("");
  }

  return lines.join("\n");
}

// How-to-use-memory guidance for the system prompt. Takes no arguments and
// returns constant text on purpose: it lives in the CACHED static prefix
// (context/compiler.ts), so making it depend on the store would rewrite the
// prefix on every save and bust the session's prompt cache. What memories
// *exist* is answered on demand by `memory(action: "list")`; what memories are
// *relevant* is injected per turn by renderRetrievedMemories below.
export function buildMemoryGuidanceBlock(): string {
  return [
    "# Memory",
    "",
    "You can remember things across sessions with the `memory` tool. Save when you",
    "learn something still true next week; skip anything this task's end makes stale.",
    "",
    "- **user** — who they are, how they like to work",
    "- **feedback** — guidance they gave you; add **Why:** and **How to apply:** lines",
    "- **project** — decisions, constraints, deadlines not derivable from the code",
    "- **reference** — pointers to external systems (dashboards, tickets, docs)",
    "",
    "Do not save what the repo already records — code structure, past fixes, git",
    "history, CLAUDE.md — or anything else derivable by reading the project.",
    "",
    "Link related memories with [[their-name]]. Saving an existing name updates it;",
    "use `memory(action: \"list\")` first if you are unsure one already covers it.",
    "Relevant memories are surfaced to you automatically — you rarely need to list.",
  ].join("\n");
}

// Lean per-turn block for memories the graph service surfaced as relevant to
// the current context. Kept compact (no full usage preamble) since it is
// injected every turn; the "how to use memory" guidance lives elsewhere.
export function renderRetrievedMemories(entries: MemoryEntry[]): string {
  if (entries.length === 0) return "";

  const lines: string[] = [
    "# Relevant memories",
    "",
    "Memories surfaced as relevant to the current request (verify before relying on them):",
  ];

  const byType = new Map<MemoryType, MemoryEntry[]>();
  for (const entry of entries) {
    const list = byType.get(entry.type) ?? [];
    list.push(entry);
    byType.set(entry.type, list);
  }

  for (const type of [
    "user",
    "feedback",
    "project",
    "reference",
  ] as MemoryType[]) {
    const typeEntries = byType.get(type) ?? [];
    if (typeEntries.length === 0) continue;

    lines.push("");
    lines.push(`## ${type.charAt(0).toUpperCase() + type.slice(1)}`);
    for (const entry of typeEntries) {
      lines.push("");
      lines.push(`### ${entry.name}`);
      lines.push(entry.content);
    }
  }

  return lines.join("\n");
}
