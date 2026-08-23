import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  commitBaseline,
  diffSinceBaseline,
  ensureRepo,
} from "./git-baseline.js";

function withDir(fn: (dir: string) => Promise<void>) {
  return async () => {
    const dir = mkdtempSync(join(tmpdir(), "mem-git-"));
    try {
      await fn(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };
}

const write = (dir: string, name: string, body: string) => {
  mkdirSync(join(dir, "project"), { recursive: true });
  writeFileSync(join(dir, "project", name), body);
};

test(
  "the first run has no baseline, so there is no diff to hand the model",
  withDir(async (dir) => {
    write(dir, "a.md", "first memory");
    assert.equal(
      await diffSinceBaseline(dir),
      null,
      "null means 'fall back to heuristics', not 'nothing changed'",
    );
  }),
);

test(
  "a diff after the baseline lists exactly the changed files",
  withDir(async (dir) => {
    write(dir, "a.md", "original");
    assert.equal(await commitBaseline(dir, "baseline"), true);

    write(dir, "a.md", "edited");
    write(dir, "b.md", "brand new");

    const result = await diffSinceBaseline(dir);
    assert.ok(result, "a baseline exists now");
    assert.deepEqual(result.files.sort(), ["project/a.md", "project/b.md"]);
    assert.match(result.diff, /edited/);
    assert.match(result.diff, /brand new/, "untracked files appear too");
  }),
);

test(
  "a deletion appears in the diff — that is the forgetting mechanism",
  withDir(async (dir) => {
    write(dir, "gone.md", "doomed");
    await commitBaseline(dir, "baseline");

    rmSync(join(dir, "project", "gone.md"));
    const result = await diffSinceBaseline(dir);
    assert.ok(result);
    assert.deepEqual(result.files, ["project/gone.md"]);
    assert.match(result.diff, /-doomed/, "the removed content is visible");
  }),
);

test(
  "no changes since the baseline yields an empty file list",
  withDir(async (dir) => {
    write(dir, "a.md", "stable");
    await commitBaseline(dir, "baseline");

    const result = await diffSinceBaseline(dir);
    assert.ok(result);
    assert.deepEqual(result.files, [], "nothing to consolidate");
  }),
);

test(
  "a failed run leaves the baseline put, so the next diff spans both windows",
  withDir(async (dir) => {
    write(dir, "a.md", "v1");
    await commitBaseline(dir, "baseline");

    // Window 1 — the run that failed does NOT commit.
    write(dir, "b.md", "written in window 1");
    // Window 2.
    write(dir, "c.md", "written in window 2");

    const result = await diffSinceBaseline(dir);
    assert.ok(result);
    assert.deepEqual(
      result.files.sort(),
      ["project/b.md", "project/c.md"],
      "a superset, so nothing written during the failed window is missed",
    );
  }),
);

test(
  ".graph/ is ignored — derived state must never enter history",
  withDir(async (dir) => {
    mkdirSync(join(dir, ".graph"), { recursive: true });
    writeFileSync(join(dir, ".graph", "usage.json"), "{}");
    write(dir, "a.md", "real memory");
    await commitBaseline(dir, "baseline");

    writeFileSync(join(dir, ".graph", "usage.json"), '{"changed":true}');
    const result = await diffSinceBaseline(dir);
    assert.ok(result);
    assert.deepEqual(
      result.files,
      [],
      "churn in the sidecar must not look like a memory change",
    );
  }),
);

test(
  "a huge diff drops its body but keeps the file list",
  withDir(async (dir) => {
    write(dir, "a.md", "small");
    await commitBaseline(dir, "baseline");
    write(dir, "a.md", "x".repeat(200_000));

    const result = await diffSinceBaseline(dir);
    assert.ok(result);
    assert.deepEqual(result.files, ["project/a.md"]);
    assert.equal(
      result.diff,
      "",
      "a truncated diff would hand the model half a memory to act on",
    );
  }),
);

test(
  "a non-existent memory directory is handled, not thrown",
  withDir(async (dir) => {
    const missing = join(dir, "nope");
    assert.equal(await ensureRepo(missing), false);
    assert.equal(await diffSinceBaseline(missing), null);
    assert.equal(await commitBaseline(missing, "m"), false);
  }),
);
