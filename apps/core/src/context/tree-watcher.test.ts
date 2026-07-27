import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
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
    await sleep(300); // let chokidar finish its initial scan

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
