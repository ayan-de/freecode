// =============================================================================
// Memory Prompt - Build memory context for system prompts
// =============================================================================

import type { MemoryEntry, MemoryType } from "./mem-types"
import { MemoryStore } from "./mem-store"
import { findRelevantMemories } from "./mem-query"

export interface MemoryPromptOptions {
  includeAll?: boolean
  types?: MemoryType[]
  limit?: number
}

export function buildMemoryPrompt(
  store: MemoryStore,
  options: MemoryPromptOptions = {}
): string {
  const { includeAll = false, types, limit = 10 } = options

  let entries: MemoryEntry[]
  if (includeAll) {
    entries = store.list()
  } else {
    entries = findRelevantMemories("", store, { types, limit })
  }

  if (entries.length === 0) {
    return ""
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
  ]

  // Group by type
  const byType = new Map<MemoryType, MemoryEntry[]>()
  for (const entry of entries) {
    const list = byType.get(entry.type) ?? []
    list.push(entry)
    byType.set(entry.type, list)
  }

  for (const type of ["user", "feedback", "project", "reference"] as MemoryType[]) {
    const typeEntries = byType.get(type) ?? []
    if (typeEntries.length === 0) continue

    lines.push(`## ${type.charAt(0).toUpperCase() + type.slice(1)}`)
    for (const entry of typeEntries) {
      lines.push("")
      lines.push(`### ${entry.name}`)
      lines.push(entry.content)
    }
    lines.push("")
  }

  return lines.join("\n")
}
