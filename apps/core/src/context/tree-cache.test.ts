// =============================================================================
// Project Context Cache Tests — Phase 5
// =============================================================================

import test from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "os";
import { mkdtempSync, writeFileSync } from "fs";
import { join, basename } from "path";
import { getProjectContext, invalidateProjectContext } from "./tree-cache.js";

test("caches the tree and only recomputes after invalidation", () => {
  const dir = mkdtempSync(join(tmpdir(), "freecode-tree-cache-"));
  writeFileSync(join(dir, "a.txt"), "a");

  const first = getProjectContext(dir);
  assert.equal(first.name, basename(dir));
  assert.match(first.tree, /a\.txt/);
  assert.equal(first.gitHead, "no-git");

  // New file on disk — cache must still serve the old tree (event-driven
  // invalidation, not stat-per-call)
  writeFileSync(join(dir, "b.txt"), "b");
  const cached = getProjectContext(dir);
  assert.equal(cached, first, "same cached object served");
  assert.doesNotMatch(cached.tree, /b\.txt/);

  // Invalidate (what the loop does after a mutating tool) → fresh tree
  invalidateProjectContext(dir);
  const fresh = getProjectContext(dir);
  assert.notEqual(fresh, first);
  assert.match(fresh.tree, /b\.txt/);
});

test("invalidateProjectContext() without args clears all projects", () => {
  const dirA = mkdtempSync(join(tmpdir(), "freecode-tree-a-"));
  const dirB = mkdtempSync(join(tmpdir(), "freecode-tree-b-"));
  const a = getProjectContext(dirA);
  const b = getProjectContext(dirB);

  invalidateProjectContext();

  assert.notEqual(getProjectContext(dirA), a);
  assert.notEqual(getProjectContext(dirB), b);
});
