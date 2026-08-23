import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { MemoryStore } from "./mem-store.js";
import {
  buildMemoryGuidanceBlock,
  MAX_MEMORY_BLOCK_BYTES,
  renderRetrievedMemories,
} from "./mem-prompt.js";
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

// -- D2: the injected block has a hard byte ceiling ---------------------------

function sized(name: string, contentBytes: number): MemoryEntry {
  return {
    name,
    type: "project",
    description: `about ${name}`,
    content: "x".repeat(contentBytes),
    createdAt: 0,
    updatedAt: 0,
  };
}

test("a single oversized memory renders under the cap", () => {
  const rendered = renderRetrievedMemories([sized("huge", 10_000)]);
  assert.ok(
    Buffer.byteLength(rendered, "utf-8") <= MAX_MEMORY_BLOCK_BYTES,
    `block was ${Buffer.byteLength(rendered, "utf-8")} bytes`,
  );
  assert.ok(
    rendered.includes("- huge — about huge"),
    "degrades to its description rather than vanishing",
  );
  assert.ok(!rendered.includes("x".repeat(500)), "body is not included");
});

test("the budget is spent in relevance order, not per section", () => {
  // The first entry is the most relevant and must keep its body; the later one
  // degrades even though it renders in an earlier section (user before
  // project). A per-section budget would get this backwards.
  const rendered = renderRetrievedMemories([
    sized("first", 1_200),
    { ...sized("second", 1_200), type: "user" },
  ]);
  assert.ok(rendered.includes("### first"), "most relevant keeps its body");
  assert.ok(
    rendered.includes("- second — about second"),
    "less relevant degrades",
  );
  assert.ok(
    Buffer.byteLength(rendered, "utf-8") <= MAX_MEMORY_BLOCK_BYTES,
    "and the whole block still fits",
  );
});

test("many small memories all render in full when they fit", () => {
  const entries = Array.from({ length: 5 }, (_, i) => sized(`m${i}`, 50));
  const rendered = renderRetrievedMemories(entries);
  for (let i = 0; i < 5; i++) {
    assert.ok(rendered.includes(`### m${i}`), `m${i} kept its body`);
  }
});

test("an empty set renders nothing at all, not an empty header", () => {
  assert.equal(renderRetrievedMemories([]), "");
});

test("the cap never truncates mid-memory", () => {
  // Degradation is by whole entries: a body is included or it is not. Half a
  // memory would read as a complete one and mislead the model.
  const rendered = renderRetrievedMemories([
    sized("a", 1_500),
    sized("b", 1_500),
  ]);
  for (const chunk of rendered.split("### ").slice(1)) {
    const body = chunk.split("\n").slice(1).join("\n").trim();
    const xs = body.replace(/[^x]/g, "");
    if (xs.length > 0) {
      assert.equal(xs.length, 1_500, "a rendered body is whole");
    }
  }
});
