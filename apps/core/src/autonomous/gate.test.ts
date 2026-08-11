import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { captureGitWorktreeSnapshot, runGate, runGateCommand } from "./gate.js";

function initRepo(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "gate-test-"));
  execFileSync("git", ["init", "-q"], { cwd: dir });
  execFileSync("git", ["config", "user.email", "t@t.com"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "t"], { cwd: dir });
  writeFileSync(join(dir, "a.txt"), "hello\n");
  execFileSync("git", ["add", "."], { cwd: dir });
  execFileSync("git", ["commit", "-q", "-m", "init"], { cwd: dir });
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test("runGateCommand: passing command reports passed", () => {
  const { dir, cleanup } = initRepo();
  const result = runGateCommand("true", dir);
  assert.equal(result.passed, true);
  cleanup();
});

test("runGateCommand: failing command reports not passed, never throws", () => {
  const { dir, cleanup } = initRepo();
  const result = runGateCommand("exit 1", dir);
  assert.equal(result.passed, false);
  cleanup();
});

test("captureGitWorktreeSnapshot: differs after an edit", () => {
  const { dir, cleanup } = initRepo();
  const before = captureGitWorktreeSnapshot(dir);
  writeFileSync(join(dir, "a.txt"), "changed\n");
  const after = captureGitWorktreeSnapshot(dir);
  assert.notEqual(before, after);
  cleanup();
});

test("captureGitWorktreeSnapshot: non-git dir degrades to empty string, no throw", () => {
  const dir = mkdtempSync(join(tmpdir(), "gate-nongit-"));
  assert.equal(captureGitWorktreeSnapshot(dir), "");
  rmSync(dir, { recursive: true, force: true });
});

test("runGate: re-runs when the worktree changed since the last failure", () => {
  const { dir, cleanup } = initRepo();
  const first = runGate("exit 1", dir, undefined, undefined);
  assert.equal(first.result.skipped, false);
  writeFileSync(join(dir, "a.txt"), "changed\n");
  const second = runGate("exit 1", dir, first.snapshot, first.result);
  assert.equal(second.result.skipped, false);
  cleanup();
});

test("runGate: skips re-running when the worktree is unchanged since the last failure", () => {
  const { dir, cleanup } = initRepo();
  writeFileSync(join(dir, "a.txt"), "dirty\n");
  const first = runGate("exit 1", dir, undefined, undefined);
  assert.equal(first.result.skipped, false);
  const second = runGate("exit 1", dir, first.snapshot, first.result);
  assert.equal(second.result.skipped, true);
  assert.equal(second.result.passed, false);
  cleanup();
});

test("runGate: never skips after a pass, even if unchanged", () => {
  const { dir, cleanup } = initRepo();
  const first = runGate("true", dir, undefined, undefined);
  assert.equal(first.result.passed, true);
  const second = runGate("true", dir, first.snapshot, first.result);
  assert.equal(second.result.skipped, false);
  cleanup();
});
