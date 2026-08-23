import test from "node:test";
import assert from "node:assert/strict";
import { parseCitations, stripCitations } from "./citations.js";

test("parses a well-formed tag and strips it from the visible text", () => {
  const r = parseCitations(
    "Use the keychain.\n<memory-used>project/auth-tokens-in-keychain</memory-used>",
  );
  assert.deepEqual(r.ids, ["project/auth-tokens-in-keychain"]);
  assert.equal(r.stripped, "Use the keychain.");
  assert.ok(!r.stripped.includes("memory-used"));
});

test("parses several ids and preserves their order", () => {
  const r = parseCitations("<memory-used>user/a, project/b, feedback/c</memory-used>");
  assert.deepEqual(r.ids, ["user/a", "project/b", "feedback/c"]);
});

test("no tag yields no ids and returns the text unchanged", () => {
  const text = "Just an ordinary answer.";
  const r = parseCitations(text);
  assert.deepEqual(r.ids, []);
  assert.equal(r.stripped, text);
});

test("a fenced tag is stripped along with its fence", () => {
  // Models fence the tag often enough that leaving an empty ``` behind would
  // be a visible artefact in every such reply.
  const r = parseCitations(
    "Done.\n\n```\n<memory-used>project/a</memory-used>\n```",
  );
  assert.deepEqual(r.ids, ["project/a"]);
  assert.equal(r.stripped, "Done.");
});

test("tolerates whitespace, a trailing period, and a repeated tag", () => {
  const r = parseCitations(
    "x <memory-used>  project/a .  </memory-used> y <memory-used>project/b</memory-used>",
  );
  assert.deepEqual(r.ids, ["project/a", "project/b"]);
  assert.equal(r.stripped, "x  y");
});

test("duplicate ids are counted once", () => {
  const r = parseCitations("<memory-used>project/a, project/a</memory-used>");
  assert.deepEqual(r.ids, ["project/a"]);
});

test("malformed ids are discarded while siblings survive", () => {
  const r = parseCitations(
    "<memory-used>project/a, not-an-id, /b, project/, project/c</memory-used>",
  );
  assert.deepEqual(r.ids, ["project/a", "project/c"]);
});

test("an empty tag is not an error, just no citation", () => {
  const r = parseCitations("answer\n<memory-used></memory-used>");
  assert.deepEqual(r.ids, []);
  assert.equal(r.stripped, "answer");
});

test("an unclosed tag is left alone rather than eating the reply", () => {
  // Truncation mid-tag must not silently delete the answer the user is reading.
  const text = "important answer <memory-used>project/a";
  const r = parseCitations(text);
  assert.deepEqual(r.ids, []);
  assert.ok(r.stripped.includes("important answer"));
});

test("stripCitations is idempotent", () => {
  const once = stripCitations("a\n<memory-used>project/x</memory-used>");
  assert.equal(stripCitations(once), once);
});
