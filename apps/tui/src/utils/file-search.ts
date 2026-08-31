// =============================================================================
// fd-less file search
// pi-tui drives `@` file mentions by shelling out to fd; handed `null` for the
// fd path it returns no `@` suggestions at all. fd is common on Linux/macOS and
// virtually absent on Windows, which is where `@` looked simply broken. This
// walks the tree in JS instead — same result shape, no external binary — and is
// used only when resolveFdPath() comes up empty.
// =============================================================================

import { readdir } from "fs/promises";
import * as path from "path";

export interface FileEntry {
  /** Path relative to the search root, always "/"-separated. */
  path: string;
  isDirectory: boolean;
}

// fd respects .gitignore. We don't parse ignore files, so skip the directories
// that would otherwise flood both the walk and the results.
const SKIP_DIRS = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  "out",
  ".next",
  ".turbo",
  ".cache",
  "target",
  "vendor",
  "__pycache__",
  ".venv",
  "venv",
]);

/** Walk budget. Breadth-first, so hitting it drops the deepest paths first. */
const MAX_ENTRIES = 20000;

/**
 * The editor calls this on every keystroke after `@`. One walk per root is
 * enough to serve a whole burst of typing; the TTL keeps it from going stale
 * while the user is still editing files in another pane.
 */
const CACHE_TTL_MS = 5000;

let cache: { root: string; at: number; entries: FileEntry[] } | null = null;

/** Test seam — the cache is process-wide and would leak between cases. */
export function clearFileSearchCache(): void {
  cache = null;
}

async function walk(root: string, signal: AbortSignal): Promise<FileEntry[]> {
  const entries: FileEntry[] = [];
  // Breadth-first: shallow paths are the likelier mention targets, so they are
  // the ones that survive MAX_ENTRIES.
  const queue: string[] = [""];

  while (queue.length > 0 && entries.length < MAX_ENTRIES) {
    if (signal.aborted) return entries;
    const relDir = queue.shift() as string;

    let dirents;
    try {
      dirents = await readdir(path.join(root, relDir), { withFileTypes: true });
    } catch {
      continue; // Unreadable directory — skip, same as fd does.
    }

    for (const dirent of dirents) {
      const isDirectory = dirent.isDirectory();
      // Symlinks are listed but never descended into: fd guards against cycles
      // with its own bookkeeping, and we have no reason to pay for that here.
      if (!isDirectory && !dirent.isFile() && !dirent.isSymbolicLink())
        continue;
      if (isDirectory && SKIP_DIRS.has(dirent.name)) continue;

      const rel = relDir ? `${relDir}/${dirent.name}` : dirent.name;
      if (isDirectory) queue.push(rel);
      entries.push({ path: rel, isDirectory });
      if (entries.length >= MAX_ENTRIES) break;
    }
  }

  return entries;
}

async function listFiles(
  root: string,
  signal: AbortSignal,
): Promise<FileEntry[]> {
  if (cache && cache.root === root && Date.now() - cache.at < CACHE_TTL_MS) {
    return cache.entries;
  }
  const entries = await walk(root, signal);
  if (signal.aborted) return entries; // Partial walk — don't poison the cache.
  cache = { root, at: Date.now(), entries };
  return entries;
}

/**
 * Same scoring pi-tui applies to fd's output, so ranking doesn't change with
 * the backend: filename matches beat path matches, directories edge out files.
 */
function scoreEntry(
  filePath: string,
  query: string,
  isDirectory: boolean,
): number {
  const fileName = path.posix.basename(filePath).toLowerCase();
  const lowerQuery = query.toLowerCase();

  let score = 0;
  if (fileName === lowerQuery) score = 100;
  else if (fileName.startsWith(lowerQuery)) score = 80;
  else if (fileName.includes(lowerQuery)) score = 50;
  else if (filePath.toLowerCase().includes(lowerQuery)) score = 30;

  if (isDirectory && score > 0) score += 10;
  return score;
}

/**
 * Up to `limit` entries under `root` matching `query`, best first. An empty
 * query returns the shallowest entries — what a bare `@` should offer.
 */
export async function searchFiles(
  root: string,
  query: string,
  signal: AbortSignal,
  limit = 20,
): Promise<FileEntry[]> {
  const entries = await listFiles(root, signal);
  if (signal.aborted) return [];
  if (!query) return entries.slice(0, limit);

  return (
    entries
      .map((entry) => ({
        entry,
        score: scoreEntry(entry.path, query, entry.isDirectory),
      }))
      .filter(({ score }) => score > 0)
      // Sort is stable, so equal scores keep the walk's shallow-first order.
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(({ entry }) => entry)
  );
}
