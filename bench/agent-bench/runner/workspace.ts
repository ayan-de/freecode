// =============================================================================
// Workspace — a fresh checkout at the commit before the fix landed, and the
// patch the agent produced in it.
//
// One bare mirror per repo, cached; every trial gets its own hardlinked clone.
// Cloning django from the network 30 times would dominate the wall-clock column
// and would also mean the benchmark measures GitHub's mood.
// =============================================================================

import { execFileSync, spawnSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { CACHE_DIR } from "./instances.js";
import type { Instance } from "./types.js";

const MIRRORS = path.join(CACHE_DIR, "repos");

// `-c` overrides rather than inheriting the operator's global git config: the
// first smoke run emitted `c/`…`i/` path prefixes instead of `a/`…`b/`, because
// this machine has `diff.mnemonicPrefix` on. The SWE-bench grader applies the
// model patch with `git apply`, which would have rejected every one of them —
// a config file on one laptop silently scoring every agent zero.
// `stdio: pipe` because execFileSync otherwise forwards git's stderr to ours,
// which put "HEAD is now at …" in the middle of the results table.
const git = (cwd: string, ...args: string[]) =>
  execFileSync(
    "git",
    ["-c", "diff.mnemonicPrefix=false", "-c", "diff.noprefix=false", ...args],
    {
      cwd,
      encoding: "utf-8",
      maxBuffer: 64 << 20,
      stdio: ["pipe", "pipe", "pipe"],
    },
  );

export function ensureMirror(repo: string): string {
  const dir = path.join(MIRRORS, `${repo.replace("/", "__")}.git`);
  if (fs.existsSync(dir)) return dir;
  fs.mkdirSync(MIRRORS, { recursive: true });
  execFileSync(
    "git",
    ["clone", "--mirror", `https://github.com/${repo}.git`, dir],
    { stdio: "inherit" },
  );
  return dir;
}

export interface Workspace {
  dir: string;
  cleanup: () => void;
}

/**
 * A checkout at `baseCommit` — the state of the repo the moment BEFORE the fix
 * landed. Detached HEAD on purpose: there is no branch to accidentally push and
 * `git diff` against the index is the whole result.
 */
export function createWorkspace(inst: Instance): Workspace {
  const mirror = ensureMirror(inst.repo);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-bench-"));
  // `--shared` hardlinks the object store instead of copying ~250MB per trial.
  // Safe here because nothing in a trial writes to the mirror.
  execFileSync("git", ["clone", "--shared", "--no-checkout", mirror, dir], {
    stdio: "pipe",
  });
  git(dir, "checkout", "--detach", inst.baseCommit);
  return { dir, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

export interface Patch {
  diff: string;
  /** Untracked files the agent added — scratch notes, agent config, caches. */
  newFiles: string[];
}

/**
 * Everything the agent changed, as one patch.
 *
 * Staged rather than plain `git diff`, because an agent that creates a new
 * module has produced a real fix that a tracked-only diff would silently drop.
 * The cost is that scratch files land in the patch too, so they are listed
 * separately — a fix accompanied by six `notes-*.md` is a fact about the agent
 * worth seeing, not something to quietly filter.
 */
export function extractPatch(dir: string): Patch {
  const before = new Set(
    git(dir, "ls-files").split("\n").filter(Boolean),
  );
  git(dir, "add", "-A");
  const after = git(dir, "ls-files").split("\n").filter(Boolean);
  const newFiles = after.filter((f) => !before.has(f));
  // Explicit prefixes and no external difftool: this string is fed to
  // `git apply` by a grader that is not on this machine.
  const diff = git(
    dir,
    "diff",
    "--cached",
    "--no-color",
    "--no-ext-diff",
    "--src-prefix=a/",
    "--dst-prefix=b/",
  );
  return { diff, newFiles };
}

/** True when the workspace is a usable git checkout at the expected commit. */
export function verifyWorkspace(dir: string, baseCommit: string): boolean {
  const head = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd: dir,
    encoding: "utf-8",
  });
  return head.status === 0 && head.stdout.trim() === baseCommit;
}
