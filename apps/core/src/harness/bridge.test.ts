// The Phase 5 bridge. Every test passes explicit tmp dirs and a fake store —
// the real memStore/skills dirs resolve against os.homedir(), and a test that
// let them default would write fixture data into the developer's real
// ~/.freecode (the same trap inject.settings.test.ts documents).
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bridgeHarnessState, isBridgeable } from "./bridge.js";
import { formatHarnessStateForPrompt } from "./inject.js";
import { emptyHarnessState } from "./store.js";
import type { MemoryEntry, MemoryType } from "../memory/mem-types.js";
import type { MemoryStore } from "../memory/mem-store.js";
import type {
  DistillResult,
  HarnessEntry,
  HarnessEntryKind,
  HarnessScope,
  HarnessState,
} from "./types.js";

function fakeStore() {
  const saved = new Map<string, MemoryEntry>();
  const deleted: string[] = [];
  const store = {
    save(entry: MemoryEntry) {
      saved.set(entry.name, entry);
    },
    delete(name: string, _type: MemoryType) {
      deleted.push(name);
      return saved.delete(name);
    },
  } as unknown as MemoryStore;
  return { store, saved, deleted };
}

function entry(
  kind: HarnessEntryKind,
  id: string,
  scope: HarnessScope = "local",
  metadata: Record<string, unknown> = {},
): HarnessEntry {
  return {
    id,
    kind,
    title: `Title for ${id}`,
    content: `Content for ${id}`,
    path: "general",
    scope,
    reference: {},
    arguments: {},
    metadata,
    source: "distill",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    version: 1,
  };
}

function stateWith(...entries: HarnessEntry[]): HarnessState {
  const state = emptyHarnessState();
  for (const e of entries) state.entries[e.kind][e.id] = e;
  return state;
}

function ctx(over: Partial<Parameters<typeof bridgeHarnessState>[2]> = {}) {
  const root = mkdtempSync(join(tmpdir(), "harness-bridge-"));
  return {
    root,
    ctx: {
      projectPath: root,
      repoSkillsDir: join(root, "repo-skills"),
      userSkillsDir: join(root, "user-skills"),
      ...over,
    },
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

test("isBridgeable covers skills in both scopes but not global memories", () => {
  assert.equal(isBridgeable({ kind: "memory", scope: "local" }), true);
  // No global memory store exists to bridge into — see bridge.ts's header.
  assert.equal(isBridgeable({ kind: "memory", scope: "global" }), false);
  assert.equal(isBridgeable({ kind: "skill", scope: "local" }), true);
  assert.equal(isBridgeable({ kind: "skill", scope: "global" }), true);
  assert.equal(isBridgeable({ kind: "prompt", scope: "local" }), false);
  assert.equal(isBridgeable({ kind: "subagent", scope: "global" }), false);
});

test("a local memory entry is written through to the memory store and marked", () => {
  const { ctx: c, cleanup } = ctx();
  const { store, saved } = fakeStore();
  try {
    const state = stateWith(entry("memory", "test-flag"));
    bridgeHarnessState(state, undefined, { ...c, memStore: store });

    const memory = saved.get("test-flag");
    assert.ok(memory, "the memory should have been saved");
    assert.equal(memory.type, "project");
    assert.equal(memory.description, "Title for test-flag");
    assert.equal(memory.content, "Content for test-flag");
    assert.deepEqual(memory.tags, ["distilled"]);
    assert.equal(state.entries.memory["test-flag"].metadata.bridged, true);
  } finally {
    cleanup();
  }
});

test("a skill entry becomes a discoverable SKILL.md, scoped by harness scope", () => {
  const { ctx: c, cleanup } = ctx();
  const { store } = fakeStore();
  try {
    const state = stateWith(
      entry("skill", "run-tests", "local"),
      entry("skill", "release", "global"),
    );
    bridgeHarnessState(state, undefined, { ...c, memStore: store });

    const local = join(c.repoSkillsDir, "run-tests", "SKILL.md");
    const global = join(c.userSkillsDir, "release", "SKILL.md");
    assert.ok(existsSync(local), "local skill should land in the repo dir");
    assert.ok(existsSync(global), "global skill should land in the user dir");

    const text = readFileSync(local, "utf-8");
    // Frontmatter the skills loader can actually parse (name + description).
    assert.match(text, /^---\nname: run-tests\ndescription: Title for run-tests\n---\n/);
    assert.match(text, /Content for run-tests/);
  } finally {
    cleanup();
  }
});

test("global memories and non-bridgeable kinds are left alone", () => {
  const { ctx: c, cleanup } = ctx();
  const { store, saved } = fakeStore();
  try {
    const state = stateWith(
      entry("memory", "global-note", "global"),
      entry("prompt", "a-note"),
      entry("subagent", "a-role"),
    );
    bridgeHarnessState(state, undefined, { ...c, memStore: store });

    assert.equal(saved.size, 0);
    for (const [kind, id] of [
      ["memory", "global-note"],
      ["prompt", "a-note"],
      ["subagent", "a-role"],
    ] as const) {
      assert.equal(
        state.entries[kind][id].metadata.bridged,
        undefined,
        `${kind}:${id} should not be marked`,
      );
    }
  } finally {
    cleanup();
  }
});

test("the sweep is the migration: already-bridged entries are not rewritten", () => {
  const { ctx: c, cleanup } = ctx();
  const { store, saved } = fakeStore();
  try {
    // Written by Phases 2-4, before the bridge existed: no mark.
    const state = stateWith(entry("memory", "old-note"));
    bridgeHarnessState(state, undefined, { ...c, memStore: store });
    assert.ok(saved.has("old-note"), "an unmarked entry migrates on the sweep");

    saved.clear();
    bridgeHarnessState(state, undefined, { ...c, memStore: store });
    assert.equal(saved.size, 0, "a marked entry is not written again");
  } finally {
    cleanup();
  }
});

test("deleting a bridged entry removes it from the real store too", () => {
  const { ctx: c, cleanup } = ctx();
  const { store, saved, deleted } = fakeStore();
  try {
    const before = entry("memory", "stale", "local", { bridged: true });
    saved.set("stale", {} as MemoryEntry);
    const result: DistillResult = {
      id: "d1",
      summary: "drop a stale note",
      rationale: "",
      expectedOutcome: "",
      scope: "local",
      createdAt: "2026-01-01T00:00:00.000Z",
      appliedEdits: [
        { action: "delete", kind: "memory", id: "stale", before, applied: true },
      ],
    };
    // The entry is already gone from state — that's why deletes come from the
    // result rather than the sweep.
    bridgeHarnessState(emptyHarnessState(), result, { ...c, memStore: store });
    assert.deepEqual(deleted, ["stale"]);
  } finally {
    cleanup();
  }
});

test("deleting a skill entry removes its SKILL.md directory", () => {
  const { ctx: c, cleanup } = ctx();
  const { store } = fakeStore();
  try {
    const state = stateWith(entry("skill", "doomed", "local"));
    bridgeHarnessState(state, undefined, { ...c, memStore: store });
    const dir = join(c.repoSkillsDir, "doomed");
    assert.ok(existsSync(dir));

    const before = state.entries.skill["doomed"];
    const result: DistillResult = {
      id: "d2",
      summary: "drop the skill",
      rationale: "",
      expectedOutcome: "",
      scope: "local",
      createdAt: "2026-01-01T00:00:00.000Z",
      appliedEdits: [
        { action: "delete", kind: "skill", id: "doomed", before, applied: true },
      ],
    };
    bridgeHarnessState(emptyHarnessState(), result, { ...c, memStore: store });
    assert.equal(existsSync(dir), false);
  } finally {
    cleanup();
  }
});

test("an unapplied delete does not touch the real store", () => {
  const { ctx: c, cleanup } = ctx();
  const { store, deleted } = fakeStore();
  try {
    const before = entry("memory", "kept", "local", { bridged: true });
    const result: DistillResult = {
      id: "d3",
      summary: "rejected edit",
      rationale: "",
      expectedOutcome: "",
      scope: "local",
      createdAt: "2026-01-01T00:00:00.000Z",
      appliedEdits: [
        {
          action: "delete",
          kind: "memory",
          id: "kept",
          before,
          applied: false,
          error: "entry changed during distillation planning",
        },
      ],
    };
    bridgeHarnessState(emptyHarnessState(), result, { ...c, memStore: store });
    assert.deepEqual(deleted, []);
  } finally {
    cleanup();
  }
});

test("a failed bridge write leaves the entry unmarked so it retries", () => {
  const { ctx: c, cleanup } = ctx();
  try {
    const exploding = {
      save() {
        throw new Error("disk full");
      },
      delete: () => false,
    } as unknown as MemoryStore;
    const state = stateWith(entry("memory", "unlucky"));
    // Must not throw — a bridge failure cannot lose a distillation that has
    // already applied cleanly.
    bridgeHarnessState(state, undefined, { ...c, memStore: exploding });
    assert.equal(state.entries.memory["unlucky"].metadata.bridged, undefined);
  } finally {
    cleanup();
  }
});

test("bridged entries drop out of prompt injection, unbridged ones stay", () => {
  const state = stateWith(
    entry("memory", "bridged-note", "local", { bridged: true }),
    entry("memory", "global-note", "global"),
    entry("prompt", "plain-note"),
  );
  const rendered = formatHarnessStateForPrompt(state);
  assert.doesNotMatch(rendered, /bridged-note/);
  assert.match(rendered, /global-note/);
  assert.match(rendered, /plain-note/);
});

test("a fully bridged harness renders nothing at all", () => {
  const state = stateWith(
    entry("memory", "a", "local", { bridged: true }),
    entry("skill", "b", "local", { bridged: true }),
  );
  assert.equal(formatHarnessStateForPrompt(state), "");
});
