// =============================================================================
// Memory Store - File-based memory persistence
// Inspired by Claude Code's memdir/ memory system
// =============================================================================

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import type {
  MemoryEntry,
  MemoryIndex,
  MemoryIndexEntry,
  MemoryType,
} from "./mem-types.js";
import { parseMemoryFrontmatter, serializeMemoryEntry } from "./mem-types.js";

const MEMORY_INDEX_FILENAME = "MEMORY.md";
const MEMORY_DIR_NAME = "memory";

function getMemoryBaseDir(projectPath: string): string {
  const projectName = sanitizeProjectName(projectPath);
  return path.join(
    os.homedir(),
    ".freecode",
    "projects",
    projectName,
    MEMORY_DIR_NAME,
  );
}

function sanitizeProjectName(projectPath: string): string {
  // Get the directory name and sanitize it for filesystem use
  const name = path.basename(projectPath);
  return name.replace(/[^a-zA-Z0-9_-]/g, "_");
}

function getTypeDir(basePath: string, type: MemoryType): string {
  return path.join(basePath, type);
}

function getMemoryFilePath(
  basePath: string,
  type: MemoryType,
  name: string,
): string {
  const safeName = name.replace(/[^a-zA-Z0-9_-]/g, "_");
  return path.join(getTypeDir(basePath, type), `${safeName}.md`);
}

function getIndexPath(basePath: string): string {
  return path.join(basePath, MEMORY_INDEX_FILENAME);
}

// =============================================================================
// MemoryStore
// =============================================================================

export class MemoryStore {
  private basePath: string;

  constructor(projectPath: string) {
    this.basePath = getMemoryBaseDir(projectPath);
  }

  // Get the memory directory for this project
  getMemoryDir(): string {
    return this.basePath;
  }

  // Ensure all type directories exist
  private ensureDirs(): void {
    const types: MemoryType[] = ["user", "feedback", "project", "reference"];
    for (const type of types) {
      const dir = getTypeDir(this.basePath, type);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }
  }

  // Save a memory entry
  save(entry: MemoryEntry): void {
    this.ensureDirs();
    const filePath = getMemoryFilePath(this.basePath, entry.type, entry.name);
    fs.writeFileSync(filePath, serializeMemoryEntry(entry), "utf-8");
    this.updateIndex();
  }

  // Load a memory entry by name and type
  load(name: string, type: MemoryType): MemoryEntry | undefined {
    const filePath = getMemoryFilePath(this.basePath, type, name);
    if (!fs.existsSync(filePath)) {
      return undefined;
    }

    const content = fs.readFileSync(filePath, "utf-8");
    const parsed = parseMemoryFrontmatter(content);
    const stat = fs.statSync(filePath);

    return {
      name: parsed.metadata.name ?? name,
      description: parsed.metadata.description ?? "",
      type: parsed.metadata.type ?? type,
      content: parsed.content,
      createdAt: stat.birthtimeMs,
      updatedAt: stat.mtimeMs,
    };
  }

  // List all memory entries, optionally filtered by type
  list(type?: MemoryType): MemoryEntry[] {
    const types: MemoryType[] = type
      ? [type]
      : ["user", "feedback", "project", "reference"];
    const entries: MemoryEntry[] = [];

    for (const t of types) {
      const dir = getTypeDir(this.basePath, t);
      if (!fs.existsSync(dir)) continue;

      const files = fs.readdirSync(dir).filter((f) => f.endsWith(".md"));
      for (const file of files) {
        const name = path.basename(file, ".md");
        const entry = this.load(name, t);
        if (entry) {
          entries.push(entry);
        }
      }
    }

    return entries.sort((a, b) => a.name.localeCompare(b.name));
  }

  // Delete a memory entry
  delete(name: string, type: MemoryType): boolean {
    const filePath = getMemoryFilePath(this.basePath, type, name);
    if (!fs.existsSync(filePath)) {
      return false;
    }
    fs.unlinkSync(filePath);
    this.updateIndex();
    return true;
  }

  // Update the MEMORY.md index file
  updateIndex(): void {
    const entries = this.list();
    const indexEntries: MemoryIndexEntry[] = entries.map((e) => ({
      name: e.name,
      description: e.description,
      type: e.type,
      path: this.getMemoryFilePathRelative(e.type, e.name),
    }));

    const lines: string[] = [
      "# Memory Index",
      "",
      "This file is the index of all memories for this project. Do not edit manually.",
      "Use the memory tool to add, update, or remove memories.",
      "",
      "## Types of memory",
      "- **user**: User's role, goals, preferences, knowledge",
      "- **feedback**: Guidance on what to avoid/repeat",
      "- **project**: Non-derivabl context (deadlines, decisions, who's doing what)",
      "- **reference**: External system pointers (Linear, Grafana, Slack)",
      "",
      "## When to access memories",
      "- When memories seem relevant or user references prior work",
      "- MUST access when user asks to check/recall/remember",
      "- If user says *ignore* memory: treat MEMORY.md as empty",
      "",
      "## How to save memories",
      "Two-step: (1) write memory file with frontmatter, (2) add pointer to MEMORY.md index",
      "",
      "---",
      "",
    ];

    // Group by type
    const byType = new Map<MemoryType, MemoryIndexEntry[]>();
    for (const entry of indexEntries) {
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
        lines.push(`- [${entry.name}](${entry.path}) — ${entry.description}`);
      }
      lines.push("");
    }

    // Cap at ~200 lines
    const output = lines.join("\n");
    fs.writeFileSync(getIndexPath(this.basePath), output, "utf-8");
  }

  private getMemoryFilePathRelative(type: MemoryType, name: string): string {
    const safeName = name.replace(/[^a-zA-Z0-9_-]/g, "_");
    return path.join(type, `${safeName}.md`);
  }
}

// =============================================================================
// Factory
// =============================================================================

let globalMemoryStore: MemoryStore | null = null;
let globalProjectPath: string | null = null;

export function getMemoryStore(projectPath: string): MemoryStore {
  if (!globalMemoryStore || globalProjectPath !== projectPath) {
    globalMemoryStore = new MemoryStore(projectPath);
    globalProjectPath = projectPath;
  }
  return globalMemoryStore;
}
