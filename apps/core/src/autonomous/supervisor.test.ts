import test from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import {
  isAlive,
  reconcileRunStatus,
  requestCancel,
  spawnRun,
} from "./supervisor.js";
import {
  createRunManifest,
  getRunDir,
  loadRunManifest,
  saveRunManifest,
} from "./run-store.js";

const baseLimits = { maxTurns: 20, maxTokens: 150_000, timeoutMs: 3_600_000, maxUsd: 5 };

test("isAlive: true for the current process, false for a PID that doesn't exist", () => {
  assert.equal(isAlive(process.pid), true);
  // A PID astronomically unlikely to be in use on any real machine.
  assert.equal(isAlive(999_999), false);
});

test("spawnRun: records a live PID on the manifest and persists it", async () => {
  const manifest = createRunManifest(baseLimits, "true");
  const updated = spawnRun(manifest, "node", ["-e", "setTimeout(() => {}, 2000)"]);
  assert.ok(updated.pid);
  assert.equal(isAlive(updated.pid!), true);
  const loaded = loadRunManifest(manifest.id);
  assert.equal(loaded?.pid, updated.pid);
  process.kill(updated.pid!, "SIGKILL");
  rmSync(getRunDir(manifest.id), { recursive: true, force: true });
});

test("reconcileRunStatus: leaves a running manifest alone when its PID is alive", () => {
  const manifest = createRunManifest(baseLimits, "true");
  saveRunManifest({ ...manifest, pid: process.pid });
  const result = reconcileRunStatus(manifest.id);
  assert.equal(result?.status, "running");
  rmSync(getRunDir(manifest.id), { recursive: true, force: true });
});

test("reconcileRunStatus: marks crashed when the recorded PID is dead", () => {
  const manifest = createRunManifest(baseLimits, "true");
  saveRunManifest({ ...manifest, pid: 999_999 });
  const result = reconcileRunStatus(manifest.id);
  assert.equal(result?.status, "crashed");
  assert.equal(result?.stopReason, "crashed");
  const reloaded = loadRunManifest(manifest.id);
  assert.equal(reloaded?.status, "crashed");
  rmSync(getRunDir(manifest.id), { recursive: true, force: true });
});

test("reconcileRunStatus: leaves a terminal status (completed) untouched even if pid is dead", () => {
  const manifest = createRunManifest(baseLimits, "true");
  saveRunManifest({ ...manifest, pid: 999_999, status: "completed" });
  const result = reconcileRunStatus(manifest.id);
  assert.equal(result?.status, "completed");
  rmSync(getRunDir(manifest.id), { recursive: true, force: true });
});

test("reconcileRunStatus: missing run returns undefined, never throws", () => {
  assert.equal(reconcileRunStatus("does-not-exist"), undefined);
});

test("requestCancel: sets cancelRequested and persists it", () => {
  const manifest = createRunManifest(baseLimits, "true");
  saveRunManifest(manifest);
  const updated = requestCancel(manifest.id);
  assert.equal(updated?.cancelRequested, true);
  const reloaded = loadRunManifest(manifest.id);
  assert.equal(reloaded?.cancelRequested, true);
  rmSync(getRunDir(manifest.id), { recursive: true, force: true });
});

test("requestCancel: missing run returns undefined, never throws", () => {
  assert.equal(requestCancel("does-not-exist"), undefined);
});
