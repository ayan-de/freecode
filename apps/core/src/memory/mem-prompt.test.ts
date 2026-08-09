import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { MemoryStore } from "./mem-store.js";
import { buildMemoryGuidanceBlock } from "./mem-prompt.js";
import type { MemoryEntry } from "./mem-types.js";

function entry(name: string): MemoryEntry {
  return {
    name,
    type: "project",
    description: `about ${name}`,
    content: `body of ${name}`,
    createdAt: 0,
    updatedAt: 0,
  };
}

// The guidance block sits in the CACHED static system prefix. If its text ever
// varied with the store's contents, every memory save would rewrite the prefix
// and bust the whole session's prompt cache — the exact regression D2 of the
// write-path spec exists to prevent.
test("guidance block is byte-identical regardless of store contents", () => {
  const projectPath = mkdtempSync(join(tmpdir(), "mem-guidance-"));
  const store = new MemoryStore(projectPath);
  try {
    const empty = buildMemoryGuidanceBlock();

    store.save(entry("alpha"));
    store.save(entry("beta"));
    assert.equal(store.list().length, 2, "store should now be non-empty");

    assert.equal(
      buildMemoryGuidanceBlock(),
      empty,
      "guidance must not vary with stored memories",
    );
  } finally {
    rmSync(projectPath, { recursive: true, force: true });
    rmSync(dirname(store.getMemoryDir()), { recursive: true, force: true });
  }
});

test("guidance names the tool, the four types, and the exclusions", () => {
  const block = buildMemoryGuidanceBlock();
  assert.match(block, /\bmemory\b/);
  for (const type of ["user", "feedback", "project", "reference"]) {
    assert.match(block, new RegExp(`\\b${type}\\b`));
  }
  // Without an explicit exclusion list the model saves derivable facts.
  assert.match(block, /derivable|do not save|don't save/i);
});

test("guidance carries no memory bodies", () => {
  // It must stay a fixed instruction block, never a content dump — recall is
  // the graph's job (renderRetrievedMemories), not the static prefix's.
  assert.ok(
    buildMemoryGuidanceBlock().length < 1400,
    "guidance block should stay small enough to be free at cache-read rates",
  );
});
