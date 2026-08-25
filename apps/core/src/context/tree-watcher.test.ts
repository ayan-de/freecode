import test from "node:test";
import assert from "node:assert/strict";
import fs, { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getProjectContext } from "./tree-cache.js";
import { ensureWatching, stopWatching } from "./tree-watcher.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

test("a new top-level file invalidates the cached tree", async () => {
  const dir = mkdtempSync(join(tmpdir(), "freecode-tree-watch-"));
  try {
    const before = getProjectContext(dir); // populate cache
    assert.ok(!before.tree.includes("newfile.txt"));

    ensureWatching(dir);
    await sleep(300); // let the watch attach

    writeFileSync(join(dir, "newfile.txt"), "hi");

    // Poll for the debounced invalidation to land (cache recomputes with the file).
    let after = before;
    for (let i = 0; i < 40; i++) {
      await sleep(100);
      after = getProjectContext(dir);
      if (after.tree.includes("newfile.txt")) break;
    }
    assert.ok(
      after.tree.includes("newfile.txt"),
      "cache should have been invalidated and recomputed with the new file",
    );
  } finally {
    await stopWatching(dir);
    rmSync(dir, { recursive: true, force: true });
  }
});

// Regression, and the only test here that reproduces the production crash.
//
// The failure needs fs.watch to throw AFTER a successful stat — a path that
// vanishes in between, or a resource limit. That is a race, so it has to be
// injected. Under chokidar this produced `undefined is not an object
// (evaluating 'watcher.close')` inside its async add() chain, whose .then()
// has no catch, so it escaped as an unhandledRejection and server.ts tore
// down every in-flight loop.
test("an fs.watch that throws never escapes as a rejection", async () => {
  const dir = mkdtempSync(join(tmpdir(), "freecode-tree-watch-fail-"));
  const realWatch = fs.watch;
  const rejections: unknown[] = [];
  const onRejection = (reason: unknown) => rejections.push(reason);
  process.on("unhandledRejection", onRejection);
  (fs as { watch: unknown }).watch = () => {
    const err: NodeJS.ErrnoException = new Error(
      "ENOENT: no such file or directory, watch",
    );
    err.code = "ENOENT"; // chokidar's _handleError swallows this one silently
    throw err;
  };
  try {
    ensureWatching(dir); // must not throw
    await sleep(300); // give an async escape time to surface
    assert.deepEqual(rejections, [], "no rejection may escape ensureWatching");
  } finally {
    (fs as { watch: unknown }).watch = realWatch;
    process.off("unhandledRejection", onRejection);
    await stopWatching(dir);
    rmSync(dir, { recursive: true, force: true });
  }
});

// The `.git` watch is what tracks branch switches; make sure it is actually
// attached (and filtered to HEAD) when `.git` is a real directory.
test("a HEAD change invalidates the cached context", async () => {
  const dir = mkdtempSync(join(tmpdir(), "freecode-tree-head-"));
  try {
    mkdirSync(join(dir, ".git"));
    writeFileSync(join(dir, ".git", "HEAD"), "ref: refs/heads/main\n");

    // The cache entry is dropped, not rewritten, so a fresh object identity is
    // the observable signal that invalidation ran.
    const before = getProjectContext(dir);
    assert.equal(getProjectContext(dir), before, "should be cached");

    ensureWatching(dir);
    await sleep(300);

    writeFileSync(join(dir, ".git", "HEAD"), "ref: refs/heads/other\n");

    let after = before;
    for (let i = 0; i < 40; i++) {
      await sleep(100);
      after = getProjectContext(dir);
      if (after !== before) break;
    }
    assert.notEqual(after, before, "a HEAD write should invalidate the cache");
  } finally {
    await stopWatching(dir);
    rmSync(dir, { recursive: true, force: true });
  }
});
