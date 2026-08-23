import test from "node:test";
import assert from "node:assert/strict";
import { Bm25Index } from "./bm25.js";
import type { MemoryEntry } from "./mem-types.js";

function entry(
  name: string,
  description: string,
  content: string,
): MemoryEntry {
  return {
    name,
    description,
    type: "project",
    content,
    createdAt: 0,
    updatedAt: 0,
  };
}

test("IDF demotes a term present in every document", () => {
  // "memory" is universal; "keychain" is rare. A query containing both must
  // rank the document with the rare term first, which the old substring scorer
  // could not do — it awarded the same +1 either way.
  const index = new Bm25Index([
    entry("a", "memory thing", "memory memory memory"),
    entry("b", "memory thing", "memory memory memory"),
    entry("c", "memory keychain", "memory keychain storage"),
  ]);

  const ranked = index.search("memory keychain");
  assert.equal(ranked[0]?.id, "project/c", "rare term decides the ranking");
});

test("length normalization stops a long memory outranking a precise one", () => {
  // The exact defect in the shipped scorer: one query term, present once in a
  // short focused document and once in a long rambling one. Unnormalized
  // scoring ties them (or favours the long one via incidental extra overlap);
  // BM25 must prefer the short one.
  const filler = "unrelated padding sentence about other topics ".repeat(40);
  const index = new Bm25Index([
    entry("short", "jitter backoff", "retries use jitter"),
    entry("long", "assorted notes", `${filler} retries use jitter ${filler}`),
  ]);

  const ranked = index.search("jitter");
  assert.equal(ranked[0]?.id, "project/short", "concise document wins");
  assert.ok(
    (ranked[0]?.score ?? 0) > (ranked[1]?.score ?? 0),
    "and by a real margin, not a tie",
  );
});

test("description terms outweigh the same term in the body", () => {
  const index = new Bm25Index([
    entry("in-description", "compaction threshold", "unrelated body text here"),
    entry("in-body", "unrelated summary text", "compaction threshold appears"),
  ]);

  const ranked = index.search("compaction threshold");
  assert.equal(ranked[0]?.id, "project/in-description");
});

test("an exact name match beats term overlap alone", () => {
  const index = new Bm25Index([
    entry("sse-stall-timeout", "streaming", "short body"),
    entry("other", "sse stall timeout discussed at length", "sse stall timeout"),
  ]);

  const ranked = index.search("sse-stall-timeout");
  assert.equal(ranked[0]?.id, "project/sse-stall-timeout");
});

test("empty and single-document corpora do not divide by zero", () => {
  assert.deepEqual(new Bm25Index([]).search("anything"), []);

  const single = new Bm25Index([entry("only", "the only memory", "body")]);
  const ranked = single.search("only memory");
  assert.equal(ranked.length, 1);
  assert.ok(Number.isFinite(ranked[0]?.score), "score is a real number");
  assert.ok((ranked[0]?.score ?? 0) > 0, "and positive");
});

test("a query with no matching term returns nothing rather than everything", () => {
  const index = new Bm25Index([
    entry("a", "streaming timeouts", "sse stall"),
    entry("b", "database choice", "sqlite over postgres"),
  ]);
  assert.deepEqual(index.search("quicksort partitioning"), []);
});

test("stop-length tokens are dropped, so short noise words match nothing", () => {
  const index = new Bm25Index([entry("a", "the cat sat", "on the mat")]);
  assert.deepEqual(index.search("on"), [], "2-char token is not indexed");
});

test("rebuilding replaces the previous corpus rather than appending", () => {
  const index = new Bm25Index([entry("old", "obsolete note", "body")]);
  index.build([entry("new", "current note", "body")]);
  assert.equal(index.size(), 1);
  assert.deepEqual(index.search("obsolete"), [], "old document is gone");
});
