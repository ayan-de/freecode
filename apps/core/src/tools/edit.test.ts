import { test } from "node:test";
import assert from "node:assert/strict";
import { applyEdit } from "./edit.js";

test("applyEdit replaces a unique match", () => {
  const result = applyEdit("foo\nbar\nbaz", "bar", "qux", false);
  assert.equal(result, "foo\nqux\nbaz");
});

test("applyEdit throws on an ambiguous match instead of silently picking the last one", () => {
  assert.throws(
    () => applyEdit("x\nx\nx", "x", "y", false),
    /ambiguous: found 3 matches/,
  );
});

test("applyEdit replaceAll still replaces every occurrence of an ambiguous match", () => {
  const result = applyEdit("x\nx\nx", "x", "y", true);
  assert.equal(result, "y\ny\ny");
});
