import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { MemoryStore, getMemoryStore } from "./mem-store.js";
import { consolidateMemories, parsePlan } from "./consolidate.js";
import type { MemoryEntry } from "./mem-types.js";

function mem(name: string, content = `body of ${name}`): MemoryEntry {
  return {
    name,
    type: "project",
    description: `about ${name}`,
    content,
    createdAt: 0,
    updatedAt: 0,
  };
}

function fixture(fn: (ctx: { path: string; store: MemoryStore }) => Promise<void>) {
  return async () => {
    const path = mkdtempSync(join(tmpdir(), "mem-consolidate-"));
    const store = getMemoryStore(path);
    try {
      await fn({ path, store });
    } finally {
      rmSync(path, { recursive: true, force: true });
      rmSync(dirname(store.getMemoryDir()), { recursive: true, force: true });
    }
  };
}

const run = (path: string, reply: string, shown: string[], overflow?: string[]) =>
  consolidateMemories({
    projectPath: path,
    provider: "test",
    prompt: "irrelevant",
    shownNames: new Set(shown),
    overflowEpisodes: overflow,
    complete: async () => reply,
  });

test(
  "a merge writes supersedes and deletes the named originals",
  fixture(async ({ path, store }) => {
    store.save(mem("sqlite-choice"));
    store.save(mem("thread-store-sqlite"));

    const result = await run(
      path,
      JSON.stringify({
        merges: [
          {
            into: "sqlite-choice",
            supersedes: ["thread-store-sqlite"],
            description: "SQLite for the thread store",
            content: "Single-machine deployments only.",
          },
        ],
        episode: null,
        promote: [],
      }),
      ["sqlite-choice", "thread-store-sqlite"],
    );

    assert.equal(result.ok, true);
    assert.equal(result.merged, 1);
    assert.equal(result.deleted, 1);

    const survivor = store.load("sqlite-choice", "project");
    assert.deepEqual(survivor?.supersedes, ["thread-store-sqlite"]);
    assert.equal(
      store.load("thread-store-sqlite", "project"),
      undefined,
      "the superseded original is gone",
    );
    // This is the first writer in the system's history to emit supersedes, so
    // the 0.9-weight Supersedes edges finally have something to describe.
    assert.ok(survivor?.supersedes?.length);
  }),
);

test(
  "a supersedes name that was never shown is dropped, siblings still apply",
  fixture(async ({ path, store }) => {
    store.save(mem("keeper"));
    store.save(mem("shown-duplicate"));
    store.save(mem("secret-memory"));

    const result = await run(
      path,
      JSON.stringify({
        merges: [
          {
            into: "keeper",
            supersedes: ["shown-duplicate", "secret-memory"],
            description: "merged",
            content: "merged body",
          },
        ],
        episode: null,
        promote: [],
      }),
      ["keeper", "shown-duplicate"], // secret-memory was NOT shown
    );

    assert.equal(result.deleted, 1, "only the shown one is deleted");
    assert.ok(store.load("secret-memory", "project"), "unshown memory survives");
    assert.equal(store.load("shown-duplicate", "project"), undefined);
    assert.deepEqual(result.merged, 1, "the merge still applied");
  }),
);

test(
  "caps hold at 5 merges, 3 promotions, 1 episode",
  fixture(async ({ path, store }) => {
    const names: string[] = [];
    for (let i = 0; i < 8; i++) {
      store.save(mem(`into-${i}`));
      store.save(mem(`dup-${i}`));
      names.push(`into-${i}`, `dup-${i}`);
    }

    const result = await run(
      path,
      JSON.stringify({
        merges: Array.from({ length: 8 }, (_, i) => ({
          into: `into-${i}`,
          supersedes: [`dup-${i}`],
          description: "d",
          content: "c",
        })),
        episode: {
          name: "an-episode",
          description: "something happened",
          happened_at: "2026-08-23",
          content: "one sentence",
        },
        promote: Array.from({ length: 6 }, (_, i) => ({
          type: "project",
          name: `new-${i}`,
          description: "d",
          content: "c",
        })),
      }),
      names,
    );

    assert.equal(result.merged, 5, "MAX_MERGES");
    assert.equal(result.promoted, 3, "MAX_PROMOTES");
    assert.equal(result.episodes, 1, "one episode, waku's contract");
  }),
);

test(
  "a secret-bearing merge writes nothing AND deletes nothing",
  fixture(async ({ path, store }) => {
    store.save(mem("keeper", "original body"));
    store.save(mem("victim"));

    const result = await run(
      path,
      JSON.stringify({
        merges: [
          {
            into: "keeper",
            supersedes: ["victim"],
            description: "merged",
            content: "the token is sk-ant-api03-AAAABBBBCCCCDDDDEEEEFFFFGGGG",
          },
        ],
        episode: null,
        promote: [],
      }),
      ["keeper", "victim"],
    );

    assert.equal(result.merged, 0);
    assert.equal(result.deleted, 0, "dropping originals for a refused write loses data");
    assert.equal(store.load("keeper", "project")?.content, "original body");
    assert.ok(store.load("victim", "project"), "the victim survives");
  }),
);

test(
  "a malformed reply applies nothing and reports failure",
  fixture(async ({ path, store }) => {
    store.save(mem("untouched"));
    const result = await run(path, "I have decided not to answer in JSON.", [
      "untouched",
    ]);
    assert.equal(result.ok, false, "caller must not advance the baseline");
    assert.equal(result.merged + result.promoted + result.episodes, 0);
    assert.ok(store.load("untouched", "project"));
  }),
);

test(
  "a throwing provider applies nothing and does not reject",
  fixture(async ({ path, store }) => {
    store.save(mem("untouched"));
    const result = await consolidateMemories({
      projectPath: path,
      provider: "test",
      prompt: "p",
      shownNames: new Set(["untouched"]),
      complete: async () => {
        throw new Error("provider is down");
      },
    });
    assert.equal(result.ok, false);
    assert.ok(store.load("untouched", "project"));
  }),
);

test(
  "overflow episodes are deleted only after a successful call",
  fixture(async ({ path, store }) => {
    store.save({ ...mem("old-episode"), type: "episode" });

    const failed = await run(path, "not json", [], ["old-episode"]);
    assert.equal(failed.ok, false);
    assert.ok(
      store.load("old-episode", "episode"),
      "a failed run must not discard the model's chance to fold them in",
    );

    const ok = await run(
      path,
      JSON.stringify({ merges: [], episode: null, promote: [] }),
      [],
      ["old-episode"],
    );
    assert.equal(ok.ok, true);
    assert.equal(store.load("old-episode", "episode"), undefined);
  }),
);

test(
  "doing nothing is a successful outcome, not a failure",
  fixture(async ({ path }) => {
    const result = await run(
      path,
      '{"merges":[],"episode":null,"promote":[]}',
      [],
    );
    assert.equal(result.ok, true, "a healthy no-op advances the schedule");
    assert.equal(result.merged + result.promoted + result.episodes, 0);
  }),
);

test("parsePlan rejects a promotion of type episode", () => {
  // Episodes are machine-written by *this* code path, with a date we control.
  // Letting the model promote one through the semantic list would bypass that.
  const plan = parsePlan(
    JSON.stringify({
      merges: [],
      episode: null,
      promote: [
        { type: "episode", name: "x", description: "d", content: "c" },
        { type: "project", name: "y", description: "d", content: "c" },
      ],
    }),
  );
  assert.deepEqual(plan?.promote.map((p) => p.name), ["y"]);
});

test("parsePlan drops a merge that supersedes only itself", () => {
  const plan = parsePlan(
    JSON.stringify({
      merges: [{ into: "a", supersedes: ["a"], description: "d", content: "c" }],
      episode: null,
      promote: [],
    }),
  );
  assert.deepEqual(plan?.merges[0]?.supersedes, [], "self-deletion is removed");
});

test("parsePlan drops a malformed happened_at but keeps the episode", () => {
  const plan = parsePlan(
    JSON.stringify({
      merges: [],
      episode: {
        name: "e",
        description: "d",
        happened_at: "last tuesday",
        content: "c",
      },
      promote: [],
    }),
  );
  assert.equal(plan?.episode?.name, "e");
  assert.equal(plan?.episode?.happened_at, undefined);
});
