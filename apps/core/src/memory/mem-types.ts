// =============================================================================
// Memory Types - User-facing persistent memory system
// Inspired by Claude Code's memdir/ memory system
// =============================================================================

export type MemoryType = "user" | "feedback" | "project" | "reference";

export const MEMORY_TYPES: readonly MemoryType[] = [
  "user",
  "feedback",
  "project",
  "reference",
];

function isMemoryType(value: string): value is MemoryType {
  return (MEMORY_TYPES as readonly string[]).includes(value);
}

export interface MemoryEntry {
  name: string;
  description: string;
  type: MemoryType;
  content: string;
  createdAt: number;
  updatedAt: number;
  // Optional graph metadata (back-compatible; absent = none). Feed the KG:
  // tags → HasTag edges, supersedes → Supersedes edges (spec D3).
  tags?: string[];
  supersedes?: string[];
}

export interface MemoryIndexEntry {
  name: string;
  description: string;
  type: MemoryType;
  path: string;
}

export interface MemoryIndex {
  entries: MemoryIndexEntry[];
}

export interface MemoryQueryOptions {
  limit?: number;
  types?: MemoryType[];
}

// =============================================================================
// Memory Frontmatter Parsing
// =============================================================================

const FRONTMATTER_REGEX = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/;

export interface ParsedMemory {
  metadata: {
    name?: string;
    description?: string;
    type?: MemoryType;
    tags?: string[];
    supersedes?: string[];
  };
  content: string;
}

// Parse a comma-separated frontmatter list (`a, b, c` or YAML-style `[a, b, c]`).
// Empty → undefined.
function parseList(value: string | undefined): string[] | undefined {
  if (!value) return undefined;
  const stripped = value.trim().replace(/^\[/, "").replace(/\]$/, "");
  const items = stripped
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return items.length > 0 ? items : undefined;
}

export function parseMemoryFrontmatter(content: string): ParsedMemory {
  const match = content.match(FRONTMATTER_REGEX);
  if (!match) {
    return { metadata: {}, content };
  }

  const frontmatter = match[1];
  const body = match[2];

  const metadata: Record<string, string> = {};
  for (const line of frontmatter.split("\n")) {
    const colonIndex = line.indexOf(":");
    if (colonIndex === -1) continue;
    const key = line.slice(0, colonIndex).trim();
    const value = line.slice(colonIndex + 1).trim();
    metadata[key] = value;
  }

  return {
    metadata: {
      name: metadata.name,
      description: metadata.description,
      type: metadata.type && isMemoryType(metadata.type) ? metadata.type : undefined,
      tags: parseList(metadata.tags),
      supersedes: parseList(metadata.supersedes),
    },
    content: body.trim(),
  };
}

export function serializeMemoryEntry(entry: MemoryEntry): string {
  const lines = [
    "---",
    `name: ${entry.name}`,
    `description: ${entry.description}`,
    `type: ${entry.type}`,
  ];
  // Only emit optional fields when present — keeps existing files unchanged.
  if (entry.tags && entry.tags.length > 0) {
    lines.push(`tags: ${entry.tags.join(", ")}`);
  }
  if (entry.supersedes && entry.supersedes.length > 0) {
    lines.push(`supersedes: ${entry.supersedes.join(", ")}`);
  }
  lines.push("---");

  return `${lines.join("\n")}\n${entry.content}`;
}
