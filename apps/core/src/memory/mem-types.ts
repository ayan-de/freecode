// =============================================================================
// Memory Types - User-facing persistent memory system
// Inspired by Claude Code's memdir/ memory system
// =============================================================================

export type MemoryType = "user" | "feedback" | "project" | "reference"

export interface MemoryEntry {
  name: string
  description: string
  type: MemoryType
  content: string
  createdAt: number
  updatedAt: number
}

export interface MemoryIndexEntry {
  name: string
  description: string
  type: MemoryType
  path: string
}

export interface MemoryIndex {
  entries: MemoryIndexEntry[]
}

export interface MemoryQueryOptions {
  limit?: number
  types?: MemoryType[]
}

// =============================================================================
// Memory Frontmatter Parsing
// =============================================================================

const FRONTMATTER_REGEX = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/

export interface ParsedMemory {
  metadata: {
    name?: string
    description?: string
    type?: MemoryType
  }
  content: string
}

export function parseMemoryFrontmatter(content: string): ParsedMemory {
  const match = content.match(FRONTMATTER_REGEX)
  if (!match) {
    return { metadata: {}, content }
  }

  const frontmatter = match[1]
  const body = match[2]

  const metadata: Record<string, string> = {}
  for (const line of frontmatter.split("\n")) {
    const colonIndex = line.indexOf(":")
    if (colonIndex === -1) continue
    const key = line.slice(0, colonIndex).trim()
    const value = line.slice(colonIndex + 1).trim()
    metadata[key] = value
  }

  return {
    metadata: {
      name: metadata.name,
      description: metadata.description,
      type: metadata.type as MemoryType | undefined,
    },
    content: body.trim(),
  }
}

export function serializeMemoryEntry(entry: MemoryEntry): string {
  const frontmatter = [
    "---",
    `name: ${entry.name}`,
    `description: ${entry.description}`,
    `type: ${entry.type}`,
    "---",
  ].join("\n")

  return `${frontmatter}\n${entry.content}`
}
