import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRunWorktree, removeRunWorktree, runBranchName } from "./worktree.js";
import { getRunDir } from "./run-store.js";

function initRepo(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "worktree-test-"));
  execFileSync("git", ["init", "-q"], { cwd: dir });
  execFileSync("git", ["config", "user.email", "t@t.com"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "t"], { cwd: dir });
  writeFileSync(join(dir, "a.txt"), "hello\n");
  execFileSync("git", ["add", "."], { cwd: dir });
  execFileSync("git", ["commit", "-q", "-m", "init"], { cwd: dir });
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test("createRunWorktree: creates a real worktree on its own branch", () => {
  const { dir, cleanup } = initRepo();
  const runId = "11111111-2222-3333-4444-555555555555";
  const worktreePath = createRunWorktree(dir, runId);
  assert.ok(existsSync(join(worktreePath, ".git"))); // worktrees get a .git *file*, not a dir
  assert.ok(existsSync(join(worktreePath, "a.txt")));

  const branches = execFileSync("git", ["branch", "--list", runBranchName(runId)], {
    cwd: dir,
    encoding: "utf-8",
  });
  assert.match(branches, new RegExp(runBranchName(runId)));

  removeRunWorktree(dir, worktreePath);
  rmSync(getRunDir(runId), { recursive: true, force: true });
  cleanup();
});

test("createRunWorktree: an edit in the worktree never touches the source checkout", () => {
  const { dir, cleanup } = initRepo();
  const runId = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
  const worktreePath = createRunWorktree(dir, runId);
  writeFileSync(join(worktreePath, "a.txt"), "edited in the run\n");

  const sourceContent = execFileSync("git", ["show", "HEAD:a.txt"], {
    cwd: dir,
    encoding: "utf-8",
  });
  assert.equal(sourceContent, "hello\n");

  removeRunWorktree(dir, worktreePath);
  rmSync(getRunDir(runId), { recursive: true, force: true });
  cleanup();
});

test("removeRunWorktree: never throws when the worktree is already gone", () => {
  const { dir, cleanup } = initRepo();
  assert.equal(removeRunWorktree(dir, join(dir, "does-not-exist")), false);
  cleanup();
});
