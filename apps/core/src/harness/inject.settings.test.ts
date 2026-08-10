// loadHarnessPromptBlock is the single seam agent/loop.ts calls — see its
// module comment. Every call here passes explicit tmp globalDir/localDir:
// CONFIG_DIR (providers/config.ts) resolves os.homedir() once at module
// import time, so mutating process.env.HOME after that has no effect on it —
// a test that tried that would silently read/write the real ~/.freecode
// instead of a fixture. The explicit-override parameters exist specifically
// so tests never have to find that out by seeing their fixture data show up
// for real. (They also guard against a *different* mistake: positional args
// of the same type — projectRoot/sessionId/globalDir/localDir are all
// strings — silently swap without a type error. Always pass all four
// explicitly here, never rely on positional defaults, even when a test only
// cares about one of them.)
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadHarnessPromptBlock } from "./inject.js";
import { emptyHarnessState, saveHarnessState } from "./store.js";
import type { HarnessEntry } from "./types.js";

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

function entry(overrides: Partial<HarnessEntry> = {}): HarnessEntry {
  return {
    id: "note",
    kind: "prompt",
    title: "A note",
    content: "content",
    path: "general",
    scope: "global",
    reference: {},
    arguments: {},
    metadata: {},
    source: "test",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    version: 1,
    ...overrides,
  };
}

test("loadHarnessPromptBlock returns empty when harness.enabled is unset (default off)", () => {
  const { root, cleanup } = tmpProjectRoot();
  try {
    const globalDir = mkdtempSync(join(tmpdir(), "harness-global-"));
    const localDir = mkdtempSync(join(tmpdir(), "harness-local-"));
    assert.equal(
      loadHarnessPromptBlock(root, "session-1", globalDir, localDir),
      "",
    );
  } finally {
    cleanup();
  }
});

test("loadHarnessPromptBlock stays empty and never touches disk when disabled, even if a store exists", () => {
  const { root, cleanup } = tmpProjectRoot();
  try {
    writeHarnessSettings(root, false);
    const globalDir = mkdtempSync(join(tmpdir(), "harness-global-"));
    const localDir = mkdtempSync(join(tmpdir(), "harness-local-"));
    const state = emptyHarnessState();
    state.entries.prompt["x"] = entry({ id: "x", title: "should not appear" });
    saveHarnessState(globalDir, state);
    assert.equal(
      loadHarnessPromptBlock(root, "session-1", globalDir, localDir),
      "",
    );
  } finally {
    cleanup();
  }
});

test("loadHarnessPromptBlock returns empty when enabled but both stores have no entries", () => {
  const { root, cleanup } = tmpProjectRoot();
  try {
    writeHarnessSettings(root, true);
    const globalDir = mkdtempSync(join(tmpdir(), "harness-global-"));
    const localDir = mkdtempSync(join(tmpdir(), "harness-local-"));
    assert.equal(
      loadHarnessPromptBlock(root, "session-1", globalDir, localDir),
      "",
    );
  } finally {
    cleanup();
  }
});

test("loadHarnessPromptBlock renders a hand-written global entry once enabled — the Phase 1 verify step", () => {
  const { root, cleanup } = tmpProjectRoot();
  try {
    writeHarnessSettings(root, true);
    const globalDir = mkdtempSync(join(tmpdir(), "harness-global-"));
    const localDir = mkdtempSync(join(tmpdir(), "harness-local-"));

    const state = emptyHarnessState();
    state.entries.prompt["hand-written"] = entry({
      id: "hand-written",
      title: "This repo always runs pnpm, never npm",
      content: "Hand-written for the Phase 1 verify step.",
    });
    saveHarnessState(globalDir, state);

    const result = loadHarnessPromptBlock(
      root,
      "session-1",
      globalDir,
      localDir,
    );
    assert.ok(result.includes("This repo always runs pnpm, never npm"));
    assert.ok(result.includes("# Continual harness"));
  } finally {
    cleanup();
  }
});

test("loadHarnessPromptBlock renders a local-scope entry — the gap the Phase 2 live check found: a session-local distillation must be readable within its own session, not just written", () => {
  const { root, cleanup } = tmpProjectRoot();
  try {
    writeHarnessSettings(root, true);
    const globalDir = mkdtempSync(join(tmpdir(), "harness-global-"));
    const localDir = mkdtempSync(join(tmpdir(), "harness-local-"));

    const state = emptyHarnessState();
    state.entries.memory["test-command"] = entry({
      id: "test-command",
      kind: "memory",
      scope: "local",
      title: "Test command for this project",
      content: "Use pnpm test, not npm test.",
    });
    saveHarnessState(localDir, state);

    const result = loadHarnessPromptBlock(
      root,
      "session-1",
      globalDir,
      localDir,
    );
    assert.ok(result.includes("Test command for this project"));
    assert.ok(result.includes("[local:test-command]"));
  } finally {
    cleanup();
  }
});

test("loadHarnessPromptBlock merges global and local, and re-keys an id collision between them", () => {
  const { root, cleanup } = tmpProjectRoot();
  try {
    writeHarnessSettings(root, true);
    const globalDir = mkdtempSync(join(tmpdir(), "harness-global-"));
    const localDir = mkdtempSync(join(tmpdir(), "harness-local-"));

    const globalState = emptyHarnessState();
    globalState.entries.prompt["dup"] = entry({
      id: "dup",
      title: "global version",
    });
    saveHarnessState(globalDir, globalState);

    const localState = emptyHarnessState();
    localState.entries.prompt["dup"] = entry({
      id: "dup",
      scope: "local",
      title: "local version",
    });
    saveHarnessState(localDir, localState);

    const result = loadHarnessPromptBlock(
      root,
      "session-1",
      globalDir,
      localDir,
    );
    assert.ok(result.includes("global version"));
    assert.ok(result.includes("local version"));
    assert.ok(result.includes("[global:dup]"));
    assert.ok(result.includes("[local:dup]"));
  } finally {
    cleanup();
  }
});
