// =============================================================================
// The memory directory is a git repository (spec D13), adopted from codex's
// Phase 2 essentially wholesale.
//
// After each *successful* consolidation the tree is committed. That commit is
// the baseline, so the next run's `git diff baseline..worktree` is exactly
// "every memory written since we last consolidated" — additions, edits, and
// deletions, with content, for free. It replaces "assemble candidates and hope"
// and it is strictly more informative than any heuristic selection.
//
// Two properties fall out. Consolidation becomes recoverable: a bad merge is
// one `git revert` in a directory whose entire history is memory edits. And a
// user hand-editing their own memory files shows up in the diff as an authored
// change, so the consolidator sees and preserves it instead of silently
// reverting it on the next merge.
//
// Everything here degrades to a no-op. If `git` is missing or the repo is
// corrupt, consolidation falls back to heuristic candidate selection — the
// feature is an accelerant, not a prerequisite.
// =============================================================================

import { execFile } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { promisify } from "node:util";
import { logger } from "../utils/logger.js";

const exec = promisify(execFile);

// A diff larger than this is not worth sending to a model; the file list alone
// carries the signal at that size (spec D9's MAX_DIFF_BYTES).
export const MAX_DIFF_BYTES = 64 * 1024;

const BASELINE_TAG = "consolidation-baseline";
const TIMEOUT_MS = 15_000;

// `.graph/` is derived state and must never enter history: it contains the
// embeddings, the lock, and the usage counters, all of which change constantly.
const GITIGNORE = ".graph/\n";

let warnedUnavailable = false;

async function git(dir: string, args: string[]): Promise<string> {
  const { stdout } = await exec("git", args, {
    cwd: dir,
    timeout: TIMEOUT_MS,
    maxBuffer: 8 * 1024 * 1024,
    // Keep a user's global hooks, templates, and signing config out of a
    // directory they never asked to be a repository.
    env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" },
  });
  return stdout;
}

function note(error: unknown): void {
  if (warnedUnavailable) return;
  warnedUnavailable = true;
  logger.debug("[MemoryGit] unavailable; consolidation will use heuristics", {
    error,
  });
}

/** Create the repository if absent. Returns false when git is unusable. */
export async function ensureRepo(memoryDir: string): Promise<boolean> {
  try {
    if (!fs.existsSync(memoryDir)) return false;
    fs.writeFileSync(path.join(memoryDir, ".gitignore"), GITIGNORE);
    if (!fs.existsSync(path.join(memoryDir, ".git"))) {
      await git(memoryDir, ["init", "--quiet"]);
      await git(memoryDir, ["config", "user.email", "memory@freecode.local"]);
      await git(memoryDir, ["config", "user.name", "FreeCode Memory"]);
      await git(memoryDir, ["config", "commit.gpgsign", "false"]);
    }
    return true;
  } catch (error) {
    note(error);
    return false;
  }
}

/**
 * The diff from the last successful consolidation to the current worktree.
 *
 * `null` means "no diff available" — git is unusable, or there is no baseline
 * yet (the first ever run). Both are handled the same way by the caller: fall
 * back to heuristic candidate selection.
 */
export async function diffSinceBaseline(
  memoryDir: string,
): Promise<{ diff: string; files: string[] } | null> {
  try {
    if (!(await ensureRepo(memoryDir))) return null;
    // Stage everything first so *untracked* files — every memory written since
    // the last run — appear in the diff at all.
    await git(memoryDir, ["add", "-A"]);

    const hasBaseline = await git(memoryDir, [
      "tag",
      "--list",
      BASELINE_TAG,
    ]).then((out) => out.trim().length > 0);
    if (!hasBaseline) return null;

    const files = (
      await git(memoryDir, ["diff", "--name-only", BASELINE_TAG])
    )
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
    if (files.length === 0) return { diff: "", files: [] };

    const diff = await git(memoryDir, ["diff", BASELINE_TAG]);
    return {
      // Past the cap the file list alone is the signal; a truncated diff would
      // hand the model a half-written memory and invite it to act on it.
      diff: Buffer.byteLength(diff, "utf-8") > MAX_DIFF_BYTES ? "" : diff,
      files,
    };
  } catch (error) {
    note(error);
    return null;
  }
}

/**
 * Commit the current tree and move the baseline tag to it.
 *
 * Called only after a *successful* consolidation. On failure the baseline stays
 * put, so the next run's diff spans both windows — a superset, so nothing is
 * missed. That is the same loss-safety property waku's unconsolidated-log flag
 * provides and the write path already relies on.
 */
export async function commitBaseline(
  memoryDir: string,
  message: string,
): Promise<boolean> {
  try {
    if (!(await ensureRepo(memoryDir))) return false;
    await git(memoryDir, ["add", "-A"]);
    const dirty = (await git(memoryDir, ["status", "--porcelain"])).trim();
    if (dirty.length > 0) {
      await git(memoryDir, ["commit", "--quiet", "-m", message]);
    }
    // `-f` because the tag moves every run; it names a position, not a release.
    await git(memoryDir, ["tag", "-f", BASELINE_TAG]);
    return true;
  } catch (error) {
    note(error);
    return false;
  }
}
