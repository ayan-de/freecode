import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { UsageStore } from "./usage-store.js";

function withDir(fn: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "mem-usage-"));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("counters survive a round trip through disk", () => {
  withDir((dir) => {
    const a = new UsageStore(dir);
    a.recordInjected(["project/x", "project/y"]);
    a.recordCited(["project/x"], 1_700_000_000_000);
    a.dispose();

    const b = new UsageStore(dir);
    assert.deepEqual(b.get("project/x"), {
      useCount: 1,
      lastUsedAt: 1_700_000_000_000,
      injectedCount: 1,
    });
    assert.deepEqual(b.get("project/y"), {
      useCount: 0,
      lastUsedAt: 0,
      injectedCount: 1,
    });
  });
});

test("injectedCount is the denominator useCount is read against", () => {
  withDir((dir) => {
    const s = new UsageStore(dir);
    s.recordInjected(["project/shown-never-used"]);
    s.recordInjected(["project/shown-never-used"]);
    s.recordInjected(["project/useful"]);
    s.recordCited(["project/useful"]);

    // The distinction the whole feature exists for: "never useful" vs
    // "never shown" are different facts and must stay distinguishable.
    assert.equal(s.get("project/shown-never-used").useCount, 0);
    assert.equal(s.get("project/shown-never-used").injectedCount, 2);
    assert.equal(s.get("project/never-shown").injectedCount, 0);
    assert.equal(s.get("project/useful").useCount, 1);
  });
});

test("an unknown id reads as all-zero rather than undefined", () => {
  withDir((dir) => {
    const s = new UsageStore(dir);
    assert.deepEqual(s.get("project/nothing"), {
      useCount: 0,
      lastUsedAt: 0,
      injectedCount: 0,
    });
  });
});

test("a corrupt usage file reads as empty and does not throw", () => {
  withDir((dir) => {
    writeFileSync(join(dir, "usage.json"), "{not json at all");
    const s = new UsageStore(dir);
    assert.equal(s.all().size, 0);
    // And it recovers: the next write replaces the garbage.
    s.recordCited(["project/x"]);
    s.dispose();
    assert.equal(new UsageStore(dir).get("project/x").useCount, 1);
  });
});

test("a file from a future schema version is ignored, not misread", () => {
  withDir((dir) => {
    writeFileSync(
      join(dir, "usage.json"),
      JSON.stringify({ version: 2, entries: { "project/x": { weird: true } } }),
    );
    assert.equal(new UsageStore(dir).all().size, 0);
  });
});

test("malformed individual entries are skipped while valid siblings load", () => {
  withDir((dir) => {
    writeFileSync(
      join(dir, "usage.json"),
      JSON.stringify({
        version: 1,
        entries: {
          "project/good": { useCount: 3, lastUsedAt: 5, injectedCount: 9 },
          "project/bad": { useCount: "three" },
        },
      }),
    );
    const s = new UsageStore(dir);
    assert.equal(s.get("project/good").useCount, 3);
    assert.equal(s.get("project/bad").useCount, 0);
  });
});

test("forget drops a deleted memory's counters", () => {
  withDir((dir) => {
    const s = new UsageStore(dir);
    s.recordCited(["project/gone", "project/stays"]);
    s.forget(["project/gone"]);
    s.dispose();

    const reloaded = new UsageStore(dir);
    assert.equal(reloaded.get("project/gone").useCount, 0);
    assert.equal(reloaded.get("project/stays").useCount, 1);
  });
});

test("flush is atomic — no partial file is ever visible", () => {
  withDir((dir) => {
    const s = new UsageStore(dir);
    s.recordCited(["project/x"]);
    s.flush();
    // Whatever is on disk must parse; a half-written file would read as
    // corrupt and silently reset every memory's history.
    const raw = readFileSync(join(dir, "usage.json"), "utf-8");
    assert.doesNotThrow(() => JSON.parse(raw));
  });
});

test("a pending write survives process exit", () => {
  // The bug a real headless turn exposed: citations are recorded at the END of
  // a turn, the debounce is 2s, the timer is unref'd, and `freecode run` exits
  // first — so the citation was parsed correctly and then thrown away.
  withDir((dir) => {
    const store = new UsageStore(dir);
    store.recordCited(["project/x"]);
    // Deliberately no dispose() and no flush(): simulate the process going
    // away with the debounce still pending.
    process.emit("exit", 0);

    assert.equal(
      new UsageStore(dir).get("project/x").useCount,
      1,
      "the exit handler must persist it",
    );
  });
});

test("dispose unregisters its exit handler", () => {
  withDir((dir) => {
    const before = process.listenerCount("exit");
    const store = new UsageStore(dir);
    assert.equal(process.listenerCount("exit"), before + 1);
    store.dispose();
    assert.equal(
      process.listenerCount("exit"),
      before,
      "a long-lived daemon must not accumulate one listener per project",
    );
  });
});

test("flush is a no-op when nothing changed", () => {
  withDir((dir) => {
    const s = new UsageStore(dir);
    s.flush(); // clean
    assert.throws(() => readFileSync(join(dir, "usage.json"), "utf-8"));
  });
});
