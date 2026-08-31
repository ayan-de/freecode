import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";
import { clearFileSearchCache, searchFiles } from "./file-search.js";

function fixture(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "freecode-file-search-"));
  fs.mkdirSync(path.join(root, "apps", "docs"), { recursive: true });
  fs.mkdirSync(path.join(root, "node_modules", "left-pad"), {
    recursive: true,
  });
  fs.mkdirSync(path.join(root, ".git", "objects"), { recursive: true });
  fs.writeFileSync(path.join(root, "README.md"), "");
  fs.writeFileSync(path.join(root, "apps", "docs", "page.mdx"), "");
  fs.writeFileSync(path.join(root, "node_modules", "left-pad", "index.js"), "");
  fs.writeFileSync(path.join(root, ".git", "config"), "");
  return root;
}

function run(root: string, query: string) {
  clearFileSearchCache();
  return searchFiles(root, query, new AbortController().signal);
}

test("finds nested files by name", async () => {
  const results = await run(fixture(), "page");
  assert.deepEqual(
    results.map((r) => r.path),
    ["apps/docs/page.mdx"],
  );
  assert.equal(results[0]?.isDirectory, false);
});

test("skips node_modules and .git", async () => {
  const root = fixture();
  assert.deepEqual(await run(root, "left-pad"), []);
  assert.deepEqual(await run(root, "config"), []);
});

test("reports directories as directories", async () => {
  const results = await run(fixture(), "docs");
  // The file below it matches on its path too, but the directory outranks it.
  assert.deepEqual(results[0], { path: "apps/docs", isDirectory: true });
});

test("ranks a filename match above a path-only match", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "freecode-file-search-"));
  fs.mkdirSync(path.join(root, "eval"), { recursive: true });
  fs.writeFileSync(path.join(root, "eval", "cases.jsonl"), "");
  fs.writeFileSync(path.join(root, "eval.ts"), "");

  const results = await run(root, "eval.ts");
  assert.equal(results[0]?.path, "eval.ts");
});

test("an empty query offers the shallowest entries first", async () => {
  const results = await run(fixture(), "");
  assert.deepEqual(
    results
      .slice(0, 2)
      .map((r) => r.path)
      .sort(),
    ["README.md", "apps"],
  );
});

test("an aborted signal yields nothing", async () => {
  const controller = new AbortController();
  controller.abort();
  clearFileSearchCache();
  assert.deepEqual(await searchFiles(fixture(), "page", controller.signal), []);
});
