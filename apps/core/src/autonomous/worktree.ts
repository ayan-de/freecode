// =============================================================================
// Autonomous Runs Worktree — dedicated `git worktree` per run
// PRIMARY: a run must never operate in the user's active checkout, so it
// always gets its own worktree + branch under the run's directory.
// Spec: docs/superpowers/specs/2026-08-10-autonomous-runs-design.md, §4.8, §5.3
// =============================================================================

import { execFileSync } from "child_process";
import * as path from "path";
import { getRunDir } from "./run-store.js";

export function runBranchName(runId: string): string {
  return `autonomous/${runId.slice(0, 8)}`;
}

/**
 * `git worktree add <runDir>/worktree -b autonomous/<id>`, run from the
 * source repo. Throws on failure (not a git repo, dirty index conflicts,
 * etc.) — the caller decides whether that's fatal to starting the run.
 */
export function createRunWorktree(
  sourceRepoPath: string,
  runId: string,
): string {
  const dest = path.join(getRunDir(runId), "worktree");
  execFileSync(
    "git",
    ["worktree", "add", dest, "-b", runBranchName(runId)],
    { cwd: sourceRepoPath, stdio: "pipe" },
  );
  return dest;
}

/** Best-effort cleanup — never throws, so a failed removal doesn't mask the run's real result. */
export function removeRunWorktree(
  sourceRepoPath: string,
  worktreePath: string,
): boolean {
  try {
    execFileSync("git", ["worktree", "remove", worktreePath, "--force"], {
      cwd: sourceRepoPath,
      stdio: "pipe",
    });
    return true;
  } catch {
    return false;
  }
}
