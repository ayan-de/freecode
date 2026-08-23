import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { getMemoryStore } from "./mem-store.js";
import { runConsolidationIfDue } from "./consolidate-run.js";
import { resetConsolidatePolicy } from "./consolidate-policy.js";
import { readLastConsolidatedAt } from "./consolidation-lock.js";
import type { MemoryEntry } from "./mem-types.js";

const HOUR = 3_600_000;

function mem(name: string): MemoryEntry {
  return {
    name,
    type: "project",
    description: `about ${name}`,
    content: `body of ${name}`,
    createdAt: 0,
    updatedAt: 0,
  };
}

const sessions = Array.from({ length: 6 }, (_, i) => ({
  id: `s${i}`,
  lastTurnAt: Date.now() - HOUR,
  turnCount: 4,
}));

function fixture(
  fn: (ctx: {
    path: string;
    graphDir: string;
    store: ReturnType<typeof getMemoryStore>;
  }) => Promise<void>,
) {
  return async () => {
    const path = mkdtempSync(join(tmpdir(), "consolidate-run-"));
    const store = getMemoryStore(path);
    resetConsolidatePolicy();
    try {
      await fn({
        path,
        graphDir: join(store.getMemoryDir(), ".graph"),
        store,
      });
    } finally {
      rmSync(path, { recursive: true, force: true });
      rmSync(dirname(store.getMemoryDir()), { recursive: true, force: true });
    }
  };
}

test(
  "a full run merges, records the schedule, and commits a baseline",
  fixture(async ({ path, graphDir, store }) => {
    store.save(mem("sqlite-choice"));
    store.save(mem("thread-store-sqlite"));

    const result = await runConsolidationIfDue({
      projectPath: path,
      provider: "test",
      sessionId: "current",
      sessions,
      complete: async (_system, prompt) => {
        // The prompt must actually carry what D9 promises, or the model is
        // guessing and every cap downstream is protecting nothing.
        assert.match(prompt, /# Memory index/);
        assert.match(prompt, /sqlite-choice/);
        assert.match(prompt, /used: 0 times of 0 shown/);
        return JSON.stringify({
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
        });
      },
    });

    assert.ok(result, "the gates let it through");
    assert.equal(result.merged, 1);
    assert.equal(store.load("thread-store-sqlite", "project"), undefined);
    assert.ok(
      readLastConsolidatedAt(graphDir) > 0,
      "the schedule advanced on success",
    );
    assert.ok(
      existsSync(join(store.getMemoryDir(), ".git")),
      "the baseline repository exists",
    );
  }),
);

test(
  "the second run in the same day is refused by the time gate",
  fixture(async ({ path, store }) => {
    store.save(mem("a"));
    const first = await runConsolidationIfDue({
      projectPath: path,
      provider: "test",
      sessionId: "current",
      sessions,
      complete: async () => '{"merges":[],"episode":null,"promote":[]}',
    });
    assert.ok(first, "first run happened");

    resetConsolidatePolicy(); // defeat only the scan throttle
    let called = false;
    const second = await runConsolidationIfDue({
      projectPath: path,
      provider: "test",
      sessionId: "current",
      sessions,
      complete: async () => {
        called = true;
        return "{}";
      },
    });
    assert.equal(second, null);
    assert.equal(called, false, "no provider call at most once per day");
  }),
);

test(
  "a failed run rewinds the schedule so the next attempt can retry",
  fixture(async ({ path, graphDir, store }) => {
    store.save(mem("a"));
    const result = await runConsolidationIfDue({
      projectPath: path,
      provider: "test",
      sessionId: "current",
      sessions,
      complete: async () => "not json at all",
    });

    assert.equal(result?.ok, false);
    assert.equal(
      readLastConsolidatedAt(graphDir),
      0,
      "a failure must not look like a successful run",
    );
  }),
);

test(
  "not enough sessions means no lock is taken and no call is made",
  fixture(async ({ path, graphDir, store }) => {
    store.save(mem("a"));
    let called = false;
    const result = await runConsolidationIfDue({
      projectPath: path,
      provider: "test",
      sessionId: "current",
      sessions: sessions.slice(0, 2),
      complete: async () => {
        called = true;
        return "{}";
      },
    });

    assert.equal(result, null);
    assert.equal(called, false);
    assert.equal(
      readLastConsolidatedAt(graphDir),
      0,
      "a declined gate must not consume the day's slot",
    );
  }),
);
