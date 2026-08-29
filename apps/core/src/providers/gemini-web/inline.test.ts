import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { findMentions, expandMentions, inlineFiles } from "./inline.js";

let root: string;

before(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "gemini-web-inline-"));
  fs.writeFileSync(path.join(root, "a.ts"), "export const a = 1;\n");
  fs.writeFileSync(path.join(root, "b.md"), "# Title\n");
  fs.mkdirSync(path.join(root, "src"));
  fs.writeFileSync(path.join(root, "src", "deep.ts"), "deep\n");
  fs.writeFileSync(path.join(root, "bin.dat"), Buffer.from([0x41, 0x00, 0x42]));
});

after(() => fs.rmSync(root, { recursive: true, force: true }));

test("finds mentions and de-duplicates in first-seen order", () => {
  assert.deepEqual(findMentions("@a.ts and @src/deep.ts and @a.ts"), [
    "a.ts",
    "src/deep.ts",
  ]);
});

test("trims sentence punctuation without eating the extension", () => {
  assert.deepEqual(findMentions("look at @a.ts, then @b.md."), [
    "a.ts",
    "b.md",
  ]);
});

test("ignores an @ that is not at a word boundary", () => {
  // Otherwise every email address becomes a file read.
  assert.deepEqual(findMentions("mail me@example.com or use @Component"), [
    "Component",
  ]);
});

test("appends contents after the question, not before it", () => {
  const { text, files } = expandMentions("why does @a.ts fail?", root);
  assert.ok(text.indexOf("why does") < text.indexOf("export const"));
  assert.ok(text.includes("### a.ts"));
  assert.ok(text.includes("```ts"));
  assert.deepEqual(files, [{ path: "a.ts", bytes: 20, truncated: false }]);
});

test("leaves text untouched when nothing resolves", () => {
  const { text, files, skipped } = expandMentions("no @nope.ts here", root);
  assert.equal(text, "no @nope.ts here");
  assert.deepEqual(files, []);
  assert.deepEqual(skipped, [{ mention: "nope.ts", reason: "not found" }]);
});

test("refuses to escape the project directory", () => {
  // Clamping to the root instead would read some unrelated file and inline it
  // as though the user had asked for it.
  const { files, skipped } = expandMentions("@../../etc/passwd", root);
  assert.deepEqual(files, []);
  assert.equal(skipped[0].reason, "outside the project directory");
});

test("skips directories and binaries rather than inlining garbage", () => {
  const { files, skipped } = expandMentions("@src @bin.dat", root);
  assert.deepEqual(files, []);
  assert.deepEqual(
    skipped.map((s) => s.reason),
    ["is a directory", "looks binary"],
  );
});

test("truncates at the budget and says so", () => {
  const { text, files } = expandMentions("@a.ts", root, 6);
  assert.deepEqual(files, [{ path: "a.ts", bytes: 20, truncated: true }]);
  assert.ok(text.includes("truncated"));
  assert.ok(text.includes("export"));
  assert.ok(!text.includes("const a = 1"));
});

test("inlineFiles emits each file once, in the order given", () => {
  // The conversation path passes mentions gathered newest-first across every
  // user turn, so a file named on turn 1 is still present on turn 5 — and
  // present exactly once, however many turns mentioned it.
  const { block, files } = inlineFiles(["b.md", "a.ts"], root);
  assert.deepEqual(
    files.map((f) => f.path),
    ["b.md", "a.ts"],
  );
  assert.ok(block.indexOf("### b.md") < block.indexOf("### a.ts"));
  assert.equal(block.split("### a.ts").length - 1, 1);
});

test("inlineFiles returns an empty block when nothing resolves", () => {
  // Callers append the block only when it is non-empty; a bare separator with
  // no files under it reads as a truncation bug.
  const { block, files } = inlineFiles(["nope.ts"], root);
  assert.equal(block, "");
  assert.deepEqual(files, []);
});

test("budget priority follows the given order, so the stalest file drops", () => {
  const { files, skipped } = inlineFiles(["a.ts", "b.md"], root, 20);
  assert.deepEqual(
    files.map((f) => f.path),
    ["a.ts"],
  );
  assert.deepEqual(
    skipped.map((s) => s.mention),
    ["b.md"],
  );
});

test("reports a later file as skipped once the budget is spent", () => {
  // The budget is shared, so the second mention must not silently vanish — an
  // unmentioned omission is exactly what the model would fill in itself.
  const { files, skipped } = expandMentions("@a.ts @b.md", root, 20);
  assert.deepEqual(
    files.map((f) => f.path),
    ["a.ts"],
  );
  assert.deepEqual(skipped, [
    { mention: "b.md", reason: "no budget left for inlining" },
  ]);
});
