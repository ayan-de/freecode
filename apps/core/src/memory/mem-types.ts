// =============================================================================
// Memory Types - User-facing persistent memory system
// Inspired by Claude Code's memdir/ memory system
// =============================================================================

// `episode` is a fifth *type*, not a second store (spec D5). Everything
// downstream is then free: frontmatter, MemoryStore, MEMORY.md indexing,
// incremental embedding, graph nodes and edges, cascade, the explorer, and the
// memory.* IPC surface all work on it without change. A separate episodic
// store would mean re-implementing every one of those and would break the
// "one directory of markdown is the truth" invariant that makes .graph/ safely
// deletable.
export type MemoryType =
  | "user"
  | "feedback"
  | "project"
  | "reference"
  | "episode";

export const MEMORY_TYPES: readonly MemoryType[] = [
  "user",
  "feedback",
  "project",
  "reference",
  "episode",
];

// The four durable types a writer may author. Episodes are machine-written
// (D5): the model narrating its own session into memory is the noise failure
// mode the consolidation spec exists to prevent.
export const AUTHORABLE_MEMORY_TYPES: readonly MemoryType[] = [
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
  /**
   * ISO date (YYYY-MM-DD) an episode describes. Optional and back-compatible in
   * exactly the way `tags` and `supersedes` were: absent means undated, and
   * every existing file parses unchanged.
   */
  happened_at?: string;
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
    happened_at?: string;
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

// Accept only a plain ISO date. Anything else is dropped rather than stored
// unparsed: a malformed date that reaches the decay maths would silently make
// an episode look either brand new or ancient.
function parseIsoDate(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return undefined;
  return Number.isNaN(Date.parse(trimmed)) ? undefined : trimmed;
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
      happened_at: parseIsoDate(metadata.happened_at),
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
  if (entry.happened_at) {
    lines.push(`happened_at: ${entry.happened_at}`);
  }
  lines.push("---");

  return `${lines.join("\n")}\n${entry.content}`;
}
