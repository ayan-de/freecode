import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import {
  createRunManifest,
  getManifestPath,
  getRunDir,
  listRunIds,
  loadRunManifest,
  saveRunManifest,
} from "./run-store.js";

const baseLimits = { maxTurns: 20, maxTokens: 150_000, timeoutMs: 3_600_000, maxUsd: 5 };

test("createRunManifest: fresh manifest is running with zeroed usage", () => {
  const manifest = createRunManifest(baseLimits, "pnpm test");
  assert.equal(manifest.status, "running");
  assert.equal(manifest.usage.turns, 0);
  assert.equal(manifest.verifyCommand, "pnpm test");
  assert.ok(manifest.id);
});

test("save/load round-trip preserves manifest content", () => {
  const manifest = createRunManifest(baseLimits, "pnpm test", "fix the flaky test");
  saveRunManifest(manifest);
  const loaded = loadRunManifest(manifest.id);
  assert.equal(loaded?.id, manifest.id);
  assert.equal(loaded?.verifyCommand, "pnpm test");
  assert.equal(loaded?.mission, "fix the flaky test");
  rmSync(getRunDir(manifest.id), { recursive: true, force: true });
});

test("saveRunManifest: atomic write leaves no leftover tmp file", () => {
  const manifest = createRunManifest(baseLimits, "pnpm test");
  saveRunManifest(manifest);
  const runDir = getRunDir(manifest.id);
  const files = readdirSync(runDir);
  assert.ok(files.includes("manifest.json"));
  for (const f of files) assert.ok(!f.endsWith(".tmp"));
  rmSync(runDir, { recursive: true, force: true });
});

test("loadRunManifest: missing run returns undefined, never throws", () => {
  assert.equal(loadRunManifest("does-not-exist"), undefined);
});

test("loadRunManifest: corrupt json degrades to undefined", () => {
  const runId = "corrupt-test-run";
  const runDir = getRunDir(runId);
  mkdirSync(runDir, { recursive: true });
  writeFileSync(getManifestPath(runId), "{not json", "utf-8");
  assert.equal(loadRunManifest(runId), undefined);
  rmSync(runDir, { recursive: true, force: true });
});

test("listRunIds: includes a saved run's id", () => {
  const manifest = createRunManifest(baseLimits, "pnpm test");
  saveRunManifest(manifest);
  assert.ok(listRunIds().includes(manifest.id));
  rmSync(getRunDir(manifest.id), { recursive: true, force: true });
});
