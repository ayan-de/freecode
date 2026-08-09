// loadHarnessPromptBlock is the single seam agent/loop.ts calls — see its
// module comment. Every call here passes an explicit tmp globalDir: CONFIG_DIR
// (providers/config.ts) resolves os.homedir() once at module import time, so
// mutating process.env.HOME after that has no effect on it — a test that
// tried that would silently read/write the real ~/.freecode instead of a
// fixture. The explicit-override parameter exists specifically so tests never
// have to find that out by seeing their fixture data show up for real.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadHarnessPromptBlock } from "./inject.js";
import { emptyHarnessState, saveHarnessState } from "./store.js";

function tmpProjectRoot(): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), "harness-project-"));
  return {
    root,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

function writeHarnessSettings(projectRoot: string, enabled: boolean): void {
  mkdirSync(join(projectRoot, ".freecode"), { recursive: true });
  writeFileSync(
    join(projectRoot, ".freecode", "settings.json"),
    JSON.stringify({ harness: { enabled } }),
  );
}

test("loadHarnessPromptBlock returns empty when harness.enabled is unset (default off)", () => {
  const { root, cleanup } = tmpProjectRoot();
  try {
    const globalDir = mkdtempSync(join(tmpdir(), "harness-global-"));
    assert.equal(loadHarnessPromptBlock(root, globalDir), "");
  } finally {
    cleanup();
  }
});

test("loadHarnessPromptBlock stays empty and never touches disk when disabled, even if a store exists", () => {
  const { root, cleanup } = tmpProjectRoot();
  try {
    writeHarnessSettings(root, false);
    const globalDir = mkdtempSync(join(tmpdir(), "harness-global-"));
    const state = emptyHarnessState();
    state.entries.prompt["x"] = {
      id: "x",
      kind: "prompt",
      title: "should not appear",
      content: "content",
      path: "general",
      scope: "global",
      reference: {},
      arguments: {},
      metadata: {},
      source: "test",
      createdAt: "x",
      updatedAt: "x",
      version: 1,
    };
    saveHarnessState(globalDir, state);
    assert.equal(loadHarnessPromptBlock(root, globalDir), "");
  } finally {
    cleanup();
  }
});

test("loadHarnessPromptBlock returns empty when enabled but the store has no entries", () => {
  const { root, cleanup } = tmpProjectRoot();
  try {
    writeHarnessSettings(root, true);
    const globalDir = mkdtempSync(join(tmpdir(), "harness-global-"));
    assert.equal(loadHarnessPromptBlock(root, globalDir), "");
  } finally {
    cleanup();
  }
});

test("loadHarnessPromptBlock renders a hand-written global entry once enabled — the Phase 1 verify step", () => {
  const { root, cleanup } = tmpProjectRoot();
  try {
    writeHarnessSettings(root, true);
    const globalDir = mkdtempSync(join(tmpdir(), "harness-global-"));

    const state = emptyHarnessState();
    state.entries.prompt["hand-written"] = {
      id: "hand-written",
      kind: "prompt",
      title: "This repo always runs pnpm, never npm",
      content: "Hand-written for the Phase 1 verify step.",
      path: "general",
      scope: "global",
      reference: {},
      arguments: {},
      metadata: {},
      source: "test",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      version: 1,
    };
    saveHarnessState(globalDir, state);

    const result = loadHarnessPromptBlock(root, globalDir);
    assert.ok(result.includes("This repo always runs pnpm, never npm"));
    assert.ok(result.includes("# Continual harness"));
  } finally {
    cleanup();
  }
});
