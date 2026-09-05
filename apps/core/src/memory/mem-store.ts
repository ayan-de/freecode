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
import {
  MEMORY_TYPES,
  parseMemoryFrontmatter,
  serializeMemoryEntry,
} from "./mem-types.js";
import { formatSessionDirName } from "../store/path-formatter.js";
import { logger } from "../utils/logger.js";

const MEMORY_INDEX_FILENAME = "MEMORY.md";
const MEMORY_DIR_NAME = "memory";

function projectsDir(): string {
  return path.join(os.homedir(), ".freecode", "projects");
}

function getMemoryBaseDir(projectPath: string): string {
  // Full reversible path (same scheme as session dirs), not basename —
  // basename made ~/work/api and ~/side/api share one store.
  const dir = path.join(
    projectsDir(),
    formatSessionDirName(projectPath),
    MEMORY_DIR_NAME,
  );
  migrateLegacyDir(projectPath, dir);
  return dir;
}

/** The pre-migration key: sanitized basename. Kept only to find old stores. */
function legacyProjectName(projectPath: string): string {
  const name = path.basename(projectPath);
  return name.replace(/[^a-zA-Z0-9_-]/g, "_");
}

// One attempt per target dir per process; getMemoryBaseDir runs constantly.
const migrationChecked = new Set<string>();

/**
 * Move a store keyed by basename to the full-path key. The graph sidecar,
 * usage attribution, and the consolidation baseline all live inside the
 * memory dir, so one rename carries everything. When two projects shared a
 * basename the pile is claimed by whichever project touches it first — the
 * old key cannot say who wrote what, which is the bug being fixed.
 */
function migrateLegacyDir(projectPath: string, newDir: string): void {
  if (migrationChecked.has(newDir)) return;
  migrationChecked.add(newDir);
  const legacyParent = path.join(projectsDir(), legacyProjectName(projectPath));
  const legacyDir = path.join(legacyParent, MEMORY_DIR_NAME);
  if (legacyDir === newDir) return;
  try {
    if (fs.existsSync(newDir) || !fs.existsSync(legacyDir)) return;
    fs.mkdirSync(path.dirname(newDir), { recursive: true });
    fs.renameSync(legacyDir, newDir);
    // The legacy shell holds nothing else; leave it if rmdir disagrees.
    try {
      fs.rmdirSync(legacyParent);
    } catch {
      // Non-empty or already gone.
    }
  } catch (err) {
    // A concurrent process may have won the same rename.
    if (fs.existsSync(newDir)) return;
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn(
      `Could not migrate memory store ${legacyDir} -> ${newDir} (${msg}); ` +
        `memories saved before this run may not be visible`,
    );
  }
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
// Change notification — lets the derived graph/vector index stay incremental
// without mem-store depending on it (DIP). Listeners must never throw into a
// save/delete; the graph service registers here and does fire-and-forget work.
// =============================================================================

export interface MemoryChange {
  store: MemoryStore;
  entry?: MemoryEntry; // present on save
  deleted?: { name: string; type: MemoryType }; // present on delete
}

type ChangeListener = (change: MemoryChange) => void;
const changeListeners = new Set<ChangeListener>();

export function onMemoryChange(fn: ChangeListener): () => void {
  changeListeners.add(fn);
  return () => changeListeners.delete(fn);
}

function emitMemoryChange(change: MemoryChange): void {
  for (const fn of changeListeners) {
    try {
      fn(change);
    } catch {
      // A listener failure must never break a memory write.
    }
  }
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
    const types: readonly MemoryType[] = MEMORY_TYPES;
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
    emitMemoryChange({ store: this, entry });
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
      // Directory location is the source of truth — trusting frontmatter here
      // would make delete(name, entry.type) look in the wrong directory.
      type,
      content: parsed.content,
      createdAt: stat.birthtimeMs,
      updatedAt: stat.mtimeMs,
      tags: parsed.metadata.tags,
      supersedes: parsed.metadata.supersedes,
      happened_at: parsed.metadata.happened_at,
    };
  }

  // List all memory entries, optionally filtered by type
  list(type?: MemoryType): MemoryEntry[] {
    // Every type, from the single source of truth — an omission here makes a
    // whole memory type invisible to retrieval while still being on disk.
    const types: readonly MemoryType[] = type ? [type] : MEMORY_TYPES;
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
    emitMemoryChange({ store: this, deleted: { name, type } });
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
      "episode",
    ] as MemoryType[]) {
      const typeEntries = byType.get(type) ?? [];
      if (typeEntries.length === 0) continue;

      lines.push(`## ${type.charAt(0).toUpperCase() + type.slice(1)}`);
      for (const entry of typeEntries) {
        lines.push(`- [${entry.name}](${entry.path}) — ${entry.description}`);
      }
      lines.push("");
    }

    const MAX_INDEX_LINES = 200;
    let output = lines.join("\n");
    if (lines.length > MAX_INDEX_LINES) {
      output =
        lines.slice(0, MAX_INDEX_LINES).join("\n") +
        `\n\n> WARNING: index truncated at ${MAX_INDEX_LINES} lines (${lines.length} total). Remove stale memories.`;
    }
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
