// =============================================================================
// Project Context Cache — file tree + git HEAD per project (Phase 5)
// PRIMARY: Avoids re-reading the project dir and shelling out to
//          `git rev-parse` on every user message
// INVALIDATION: TTL + tree-watcher (external add/unlink / .git/HEAD). The
//          prompt path does NOT follow these invalidations mid-session —
//          see context/session-context.ts, which freezes the snapshot the
//          model sees so position 0 stays cache-stable.
// =============================================================================

import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";

export interface ProjectContext {
  name: string;
  projectPath: string;
  tree: string;
  gitHead: string;
}

const TTL_MS = 5 * 60 * 1000;

const cache = new Map<string, { ctx: ProjectContext; timestamp: number }>();

function computeProjectContext(projectPath: string): ProjectContext {
  const name = path.basename(projectPath);
  let tree = "";
  let gitHead = "";

  if (fs.existsSync(projectPath)) {
    const entries = fs.readdirSync(projectPath, { withFileTypes: true });
    tree = entries
      .map((e) => `  ${e.isDirectory() ? "📁" : "📄"} ${e.name}`)
      .join("\n");
  }

  try {
    gitHead = execSync("git rev-parse HEAD 2>/dev/null", {
      cwd: projectPath,
      encoding: "utf8",
    })
      .trim()
      .slice(0, 8);
  } catch {
    gitHead = "no-git";
  }

  return { name, projectPath, tree, gitHead };
}

export function getProjectContext(projectPath: string): ProjectContext {
  const hit = cache.get(projectPath);
  if (hit && Date.now() - hit.timestamp < TTL_MS) {
    return hit.ctx;
  }
  const ctx = computeProjectContext(projectPath);
  cache.set(projectPath, { ctx, timestamp: Date.now() });
  return ctx;
}

// Called when the process-level cache should drop (watcher / tests). Does not
// clear session freezes — see disposeFrozenSessionContext.
export function invalidateProjectContext(projectPath?: string): void {
  if (projectPath) {
    cache.delete(projectPath);
  } else {
    cache.clear();
  }
}
