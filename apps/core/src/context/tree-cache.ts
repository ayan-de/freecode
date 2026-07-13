// =============================================================================
// Project Context Cache — file tree + git HEAD per project (Phase 5)
// PRIMARY: Avoids re-reading the project dir and shelling out to
//          `git rev-parse` on every user message
// INVALIDATION: event-driven — the agent loop invalidates after any mutating
//          (isDestructive) tool completes. A short TTL is kept as a safety net
//          for edits made outside the agent (editor saves, git pulls, ...).
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

// Called by the agent loop after any mutating tool (write/edit/bash/agent)
// completes. Without an argument, drops everything.
export function invalidateProjectContext(projectPath?: string): void {
  if (projectPath) {
    cache.delete(projectPath);
  } else {
    cache.clear();
  }
}
