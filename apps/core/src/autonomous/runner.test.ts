import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runAutonomous, type TurnResult, type TurnRunner } from "./runner.js";
import { createRunManifest } from "./run-store.js";
import type { RunManifest } from "./types.js";

function initRepo(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "runner-test-"));
  execFileSync("git", ["init", "-q"], { cwd: dir });
  execFileSync("git", ["config", "user.email", "t@t.com"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "t"], { cwd: dir });
  writeFileSync(join(dir, "a.txt"), "hello\n");
  execFileSync("git", ["add", "."], { cwd: dir });
  execFileSync("git", ["commit", "-q", "-m", "init"], { cwd: dir });
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

/** Each call edits the file so the worktree fingerprint changes, forcing the
 * gate to actually re-run instead of skip. */
function editingTurnRunner(dir: string): TurnRunner {
  let n = 0;
  return {
    async runTurn(): Promise<TurnResult> {
      n += 1;
      writeFileSync(join(dir, "a.txt"), `edit ${n}\n`);
      return {
        success: true,
        usage: { inputTokens: 100, outputTokens: 50 },
      };
    },
  };
}

function noPersist(_manifest: RunManifest): void {}

test("runAutonomous: stops with gatePassed when the verify command succeeds", async () => {
  const { dir, cleanup } = initRepo();
  const manifest = createRunManifest(
    { maxTurns: 20, maxTokens: 150_000, timeoutMs: 3_600_000, maxUsd: 5 },
    "true",
  );
  const result = await runAutonomous({
    manifest,
    worktreePath: dir,
    turnRunner: editingTurnRunner(dir),
    persist: noPersist,
  });
  assert.equal(result.status, "completed");
  assert.equal(result.stopReason, "gatePassed");
  assert.equal(result.usage.turns, 1);
  cleanup();
});

test("runAutonomous: stops at maxTurns when the gate never passes", async () => {
  const { dir, cleanup } = initRepo();
  const manifest = createRunManifest(
    { maxTurns: 3, maxTokens: 150_000, timeoutMs: 3_600_000, maxUsd: 5 },
    "exit 1",
  );
  const result = await runAutonomous({
    manifest,
    worktreePath: dir,
    turnRunner: editingTurnRunner(dir),
    persist: noPersist,
  });
  assert.equal(result.status, "failed");
  assert.equal(result.stopReason, "maxTurns");
  assert.equal(result.usage.turns, 3);
  cleanup();
});

test("runAutonomous: stops at maxTokens when the gate never passes", async () => {
  const { dir, cleanup } = initRepo();
  const manifest = createRunManifest(
    { maxTurns: 100, maxTokens: 250, timeoutMs: 3_600_000, maxUsd: 5 },
    "exit 1",
  );
  const result = await runAutonomous({
    manifest,
    worktreePath: dir,
    turnRunner: editingTurnRunner(dir),
    persist: noPersist,
  });
  assert.equal(result.status, "failed");
  assert.equal(result.stopReason, "maxTokens");
  cleanup();
});

test("runAutonomous: stops at timeoutMs when the gate never passes", async () => {
  const { dir, cleanup } = initRepo();
  const manifest = createRunManifest(
    { maxTurns: 100, maxTokens: 150_000, timeoutMs: 0, maxUsd: 5 },
    "exit 1",
  );
  const result = await runAutonomous({
    manifest,
    worktreePath: dir,
    turnRunner: editingTurnRunner(dir),
    persist: noPersist,
  });
  assert.equal(result.status, "failed");
  assert.equal(result.stopReason, "timeoutMs");
  cleanup();
});

test("runAutonomous: stops at maxUsd when the gate never passes", async () => {
  const { dir, cleanup } = initRepo();
  const manifest = createRunManifest(
    { maxTurns: 100, maxTokens: 150_000, timeoutMs: 3_600_000, maxUsd: 1 },
    "exit 1",
  );
  const result = await runAutonomous({
    manifest,
    worktreePath: dir,
    turnRunner: editingTurnRunner(dir),
    estimateUsd: () => 1,
    persist: noPersist,
  });
  assert.equal(result.status, "failed");
  assert.equal(result.stopReason, "maxUsd");
  assert.equal(result.usage.turns, 1);
  cleanup();
});

test("runAutonomous: a failed turn stops the run without consuming budget further", async () => {
  const { dir, cleanup } = initRepo();
  const manifest = createRunManifest(
    { maxTurns: 20, maxTokens: 150_000, timeoutMs: 3_600_000, maxUsd: 5 },
    "exit 1",
  );
  const result = await runAutonomous({
    manifest,
    worktreePath: dir,
    turnRunner: { async runTurn(): Promise<TurnResult> { return { success: false }; } },
    persist: noPersist,
  });
  assert.equal(result.status, "failed");
  assert.equal(result.usage.turns, 0);
  cleanup();
});

test("runAutonomous: checkCancelled returning true cancels before any turn runs", async () => {
  const { dir, cleanup } = initRepo();
  const manifest = createRunManifest(
    { maxTurns: 20, maxTokens: 150_000, timeoutMs: 3_600_000, maxUsd: 5 },
    "exit 1",
  );
  const result = await runAutonomous({
    manifest,
    worktreePath: dir,
    turnRunner: editingTurnRunner(dir),
    checkCancelled: () => true,
    persist: noPersist,
  });
  assert.equal(result.status, "cancelled");
  assert.equal(result.usage.turns, 0);
  cleanup();
});

test("runAutonomous: an already-aborted signal cancels before any turn runs", async () => {
  const { dir, cleanup } = initRepo();
  const manifest = createRunManifest(
    { maxTurns: 20, maxTokens: 150_000, timeoutMs: 3_600_000, maxUsd: 5 },
    "exit 1",
  );
  const controller = new AbortController();
  controller.abort();
  const result = await runAutonomous({
    manifest,
    worktreePath: dir,
    turnRunner: editingTurnRunner(dir),
    signal: controller.signal,
    persist: noPersist,
  });
  assert.equal(result.status, "cancelled");
  assert.equal(result.usage.turns, 0);
  cleanup();
});
