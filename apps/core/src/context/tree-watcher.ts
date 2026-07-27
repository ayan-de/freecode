// =============================================================================
// Tree watcher (grok #4) — invalidate the project-context cache on EXTERNAL
// file changes. tree-cache.ts is only invalidated after our own mutating tools,
// so edits from an editor, a `git checkout`, or a subprocess left it stale (a
// real correctness bug). A chokidar watcher closes that gap.
//
// Scope kept tight to match what getProjectContext actually caches:
//   - the TOP-LEVEL dir listing (`tree`) → watch depth 0
//   - the git HEAD (`gitHead`) → watch `.git/HEAD` (branch switch / commit)
// Content edits to existing files don't change either, so they're ignored.
// Best-effort: if chokidar is unavailable, we simply don't watch (the TTL in
// tree-cache is the safety net) — never throws into the loop.
// =============================================================================

import * as path from "path";
import { invalidateProjectContext } from "./tree-cache.js";

// chokidar's minimal types; imported lazily so a missing/broken install degrades.
interface FSWatcher {
  on(event: string, cb: (p: string) => void): FSWatcher;
  close(): Promise<void>;
}

const DEBOUNCE_MS = 200;
const watchers = new Map<string, FSWatcher>();
const timers = new Map<string, NodeJS.Timeout>();

// Directories whose churn never affects the cached top-level tree or git HEAD.
const IGNORED = /(^|[/\\])(node_modules|dist|\.next|target|coverage)([/\\]|$)/;

function scheduleInvalidate(projectPath: string): void {
  if (timers.has(projectPath)) return; // already pending
  const t = setTimeout(() => {
    timers.delete(projectPath);
    invalidateProjectContext(projectPath);
  }, DEBOUNCE_MS);
  timers.set(projectPath, t);
}

// Start watching a project once. Idempotent; safe to call every turn.
export function ensureWatching(projectPath: string): void {
  if (watchers.has(projectPath)) return;
  watchers.set(projectPath, {} as FSWatcher); // reserve slot before async import
  void (async () => {
    try {
      const { default: chokidar } = await import("chokidar");
      const watch = (chokidar as { watch: (p: string[], o: unknown) => FSWatcher })
        .watch;
      // Top-level entries (depth 0) + the git HEAD file specifically.
      const w = watch([projectPath, path.join(projectPath, ".git", "HEAD")], {
        ignored: IGNORED,
        ignoreInitial: true,
        depth: 0,
        persistent: true,
      });
      const onChange = () => scheduleInvalidate(projectPath);
      w.on("add", onChange)
        .on("unlink", onChange)
        .on("addDir", onChange)
        .on("unlinkDir", onChange)
        .on("change", onChange); // .git/HEAD content change = branch switch
      watchers.set(projectPath, w);
    } catch {
      // chokidar unavailable → rely on tree-cache's TTL. Don't hold a slot.
      watchers.delete(projectPath);
    }
  })();
}

export async function stopWatching(projectPath: string): Promise<void> {
  const t = timers.get(projectPath);
  if (t) {
    clearTimeout(t);
    timers.delete(projectPath);
  }
  const w = watchers.get(projectPath);
  watchers.delete(projectPath);
  if (w && typeof w.close === "function") await w.close();
}
