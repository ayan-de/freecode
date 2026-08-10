import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  mkdirSync,
  statSync,
  readdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  emptyHarnessState,
  getHarnessStatePath,
  loadHarnessState,
  saveHarnessState,
  mergeHarnessStates,
} from "./store.js";
import type { HarnessEntry, HarnessState } from "./types.js";

function tmpDir(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "harness-store-"));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

function entry(overrides: Partial<HarnessEntry> = {}): HarnessEntry {
  return {
    id: "a-note",
    kind: "prompt",
    title: "A note",
    content: "Some durable content",
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

test("emptyHarnessState has all four kinds and no distillations", () => {
  const state = emptyHarnessState();
  assert.deepEqual(Object.keys(state.entries).sort(), [
    "memory",
    "prompt",
    "skill",
    "subagent",
  ]);
  assert.equal(state.distillations.length, 0);
  assert.equal(state.schema, 1);
});

test("save then load round-trips an entry exactly", () => {
  const { dir, cleanup } = tmpDir();
  try {
    const state = emptyHarnessState();
    state.entries.prompt["a-note"] = entry();

    saveHarnessState(dir, state);
    const loaded = loadHarnessState(dir, "global");

    assert.deepEqual(
      loaded.entries.prompt["a-note"],
      state.entries.prompt["a-note"],
    );
  } finally {
    cleanup();
  }
});

test("save is atomic: no leftover .tmp file after a successful write", () => {
  const { dir, cleanup } = tmpDir();
  try {
    saveHarnessState(dir, emptyHarnessState());
    const files = readdirSync(dir);
    assert.ok(files.every((f) => !f.endsWith(".tmp")));
    assert.ok(files.includes("harness_state.json"));
  } finally {
    cleanup();
  }
});

test("save defaults new files to 0o600", () => {
  const { dir, cleanup } = tmpDir();
  try {
    const path = saveHarnessState(dir, emptyHarnessState());
    const mode = statSync(path).mode & 0o777;
    assert.equal(mode, 0o600);
  } finally {
    cleanup();
  }
});

test("loadHarnessState degrades to empty on a missing file, never throws", () => {
  const { dir, cleanup } = tmpDir();
  try {
    const loaded = loadHarnessState(dir, "global");
    assert.deepEqual(loaded, emptyHarnessState());
  } finally {
    cleanup();
  }
});

test("loadHarnessState degrades to empty on malformed JSON, never throws", () => {
  const { dir, cleanup } = tmpDir();
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(getHarnessStatePath(dir), "{not valid json");
    const loaded = loadHarnessState(dir, "global");
    assert.deepEqual(loaded, emptyHarnessState());
  } finally {
    cleanup();
  }
});

test("loadHarnessState degrades to empty when the file is an array, not an object", () => {
  const { dir, cleanup } = tmpDir();
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(getHarnessStatePath(dir), "[1, 2, 3]");
    const loaded = loadHarnessState(dir, "global");
    assert.deepEqual(loaded, emptyHarnessState());
  } finally {
    cleanup();
  }
});

test("loadHarnessState skips an entry missing title/content rather than failing the whole load", () => {
  const { dir, cleanup } = tmpDir();
  try {
    mkdirSync(dir, { recursive: true });
    const raw: Partial<HarnessState> & { entries: Record<string, unknown> } = {
      schema: 1,
      entries: {
        prompt: { broken: { id: "broken" } }, // no title/content
        memory: {},
        skill: {},
        subagent: {},
      },
      distillations: [],
    };
    writeFileSync(getHarnessStatePath(dir), JSON.stringify(raw));
    const loaded = loadHarnessState(dir, "global");
    assert.equal(Object.keys(loaded.entries.prompt).length, 0);
  } finally {
    cleanup();
  }
});

test("mergeHarnessStates unions global and local, tagging scope", () => {
  const global = emptyHarnessState();
  global.entries.prompt["g1"] = entry({ id: "g1", scope: "global" });
  const local = emptyHarnessState();
  local.entries.prompt["l1"] = entry({ id: "l1", scope: "local" });

  const merged = mergeHarnessStates(global, local);
  assert.equal(merged.entries.prompt["g1"].scope, "global");
  assert.equal(merged.entries.prompt["l1"].scope, "local");
});

test("mergeHarnessStates re-keys a local entry that collides with a global id", () => {
  const global = emptyHarnessState();
  global.entries.prompt["dup"] = entry({ id: "dup", title: "global version" });
  const local = emptyHarnessState();
  local.entries.prompt["dup"] = entry({
    id: "dup",
    title: "local version",
    scope: "local",
  });

  const merged = mergeHarnessStates(global, local);
  assert.equal(merged.entries.prompt["dup"].title, "global version");
  assert.equal(merged.entries.prompt["local:dup"].title, "local version");
});

test("mergeHarnessStates with no local argument returns global unchanged in shape", () => {
  const global = emptyHarnessState();
  global.entries.prompt["g1"] = entry({ id: "g1" });
  const merged = mergeHarnessStates(global);
  assert.equal(Object.keys(merged.entries.prompt).length, 1);
});
