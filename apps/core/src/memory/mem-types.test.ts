import test from "node:test";
import assert from "node:assert/strict";
import { parseMemoryFrontmatter } from "./mem-types.js";

function tagsFromFrontmatter(tagsLine: string): string[] | undefined {
  const content = `---\nname: n\ndescription: d\ntype: user\ntags: ${tagsLine}\n---\nbody`;
  return parseMemoryFrontmatter(content).metadata.tags;
}

test("parses plain comma-separated tags", () => {
  assert.deepEqual(tagsFromFrontmatter("test, probe"), ["test", "probe"]);
});

test("parses YAML-style bracketed tags without leaving stray brackets", () => {
  assert.deepEqual(tagsFromFrontmatter("[editor]"), ["editor"]);
  assert.deepEqual(tagsFromFrontmatter("[tooling, package-manager]"), [
    "tooling",
    "package-manager",
  ]);
});
