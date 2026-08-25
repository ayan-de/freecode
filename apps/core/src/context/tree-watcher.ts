// =============================================================================
// Tree watcher (grok #4) — invalidate the process-level project-context cache
// on EXTERNAL file changes. Content edits to existing files don't change the
// top-level listing or git HEAD, so they're ignored.
//
// Prompt injection does not follow these invalidations mid-session: the loop
// freezes the snapshot via session-context.ts so position 0 stays byte-stable.
// The next session (or disposeFrozenSessionContext) picks up a fresh tree.
//
// Scope kept tight to match what getProjectContext actually caches:
//   - the TOP-LEVEL dir listing (`tree`) → non-recursive watch on the root
//   - the git HEAD (`gitHead`) → watch `.git`, filtered to HEAD
//
// WHY NOT CHOKIDAR
//
// This used chokidar with `persistent: false`, which is the one branch in
// chokidar 3's nodefs-handler that never checks whether the watch succeeded:
//   `watcher = createFsWatchInstance(...); return watcher.close.bind(watcher);`
// createFsWatchInstance returns undefined whenever fs.watch throws, and
// chokidar's _handleError silently swallows ENOENT/ENOTDIR. So one fs.watch
// failure — a path that vanished between chokidar's stat and its watch, or a
// resource limit — became `undefined is not an object (evaluating
// 'watcher.close')` thrown inside chokidar's async add() chain, whose .then()
// has no catch. That reached the daemon as an unhandledRejection, where
// server.ts's last-resort handler read it as a provider fault and interrupted
// every in-flight loop. Two direct fs.watch calls cover the same scope with no
// such branch to fall through.
//
// Best-effort throughout: a watch that can't be established is skipped and the
// 5-minute TTL in tree-cache.ts remains the safety net. Never throws into the
// loop.
// =============================================================================

import * as fs from "fs";
import * as path from "path";
import { invalidateProjectContext } from "./tree-cache.js";

const DEBOUNCE_MS = 200;
const watchers = new Map<string, fs.FSWatcher[]>();
const timers = new Map<string, NodeJS.Timeout>();

// Top-level entries whose own churn never affects the cached listing.
const IGNORED = new Set(["node_modules", "dist", ".next", "target", "coverage"]);

function scheduleInvalidate(projectPath: string): void {
  if (timers.has(projectPath)) return; // already pending
  const t = setTimeout(() => {
    timers.delete(projectPath);
    invalidateProjectContext(projectPath);
  }, DEBOUNCE_MS);
  timers.set(projectPath, t);
}

/**
 * fs.watch that degrades instead of throwing.
 *
 * persistent:false — the watcher must not be what keeps the process alive.
 * The server is held open by its stdio anyway, and events still fire while it
 * runs. With persistent:true any short-lived process that ran a turn (tests,
 * one-shot CLI) hangs forever instead of exiting.
 */
function watchPath(
  target: string,
  onEvent: (filename: string | null) => void,
): fs.FSWatcher | undefined {
  try {
    const w = fs.watch(target, { persistent: false }, (_event, filename) =>
      onEvent(filename ? filename.toString() : null),
    );
    // fs.watch reports post-setup failures (the watched dir is deleted, the
    // inotify limit is hit) as an 'error' EVENT. An EventEmitter with no
    // 'error' listener rethrows it as an uncaught exception, which in the
    // daemon means killing whatever turn is in flight.
    w.on("error", () => {
      // Nothing to do: the watch is dead, the TTL takes over.
    });
    return w;
  } catch {
    // ENOENT/ENOTDIR/EPERM — no watch for this path.
    return undefined;
  }
}

// Start watching a project once. Idempotent; safe to call every turn.
export function ensureWatching(projectPath: string): void {
  if (watchers.has(projectPath)) return;

  const created: fs.FSWatcher[] = [];

  // A non-recursive dir watch fires for direct children only — exactly the
  // scope of the cached tree. A filename is absent on some platforms; treat
  // that as "something changed" rather than dropping the event.
  const root = watchPath(projectPath, (filename) => {
    if (filename && IGNORED.has(filename)) return;
    scheduleInvalidate(projectPath);
  });
  if (root) created.push(root);

  // Watch the `.git` DIRECTORY rather than `.git/HEAD` directly: git replaces
  // HEAD by rename, and a file watch stays bound to the dead inode and
  // silently stops firing. (In a worktree `.git` is a file, so this watches
  // that instead; the HEAD filter then never matches and branch switches fall
  // back to the TTL — same outcome as not watching it at all.)
  const git = watchPath(path.join(projectPath, ".git"), (filename) => {
    if (filename && filename !== "HEAD") return; // index.lock & friends
    scheduleInvalidate(projectPath);
  });
  if (git) created.push(git);

  watchers.set(projectPath, created);
}

export async function stopWatching(projectPath: string): Promise<void> {
  const t = timers.get(projectPath);
  if (t) {
    clearTimeout(t);
    timers.delete(projectPath);
  }
  for (const w of watchers.get(projectPath) ?? []) {
    try {
      w.close();
    } catch {
      // Already closed.
    }
  }
  watchers.delete(projectPath);
}
