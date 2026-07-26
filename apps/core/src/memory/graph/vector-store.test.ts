import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { VectorStore } from "./vector-store.js";

const MODEL = "test-model";

function vec(...xs: number[]): Float32Array {
  return Float32Array.from(xs);
}

test("VectorStore ranks by cosine similarity and dedupes by id", () => {
  const dir = mkdtempSync(join(tmpdir(), "vs-"));
  try {
    const vs = new VectorStore(dir, MODEL);
    vs.put("a/one", "h1", vec(1, 0, 0));
    vs.put("a/two", "h2", vec(0, 1, 0));
    vs.put("a/three", "h3", vec(0.9, 0.1, 0));

    // Re-putting the same id replaces, not appends.
    vs.put("a/three", "h3b", vec(0.8, 0.2, 0));
    assert.equal(vs.size(), 3);
    assert.equal(vs.getDims(), 3);

    const top = vs.cosineTopK(vec(1, 0, 0), 2);
    assert.deepEqual(
      top.map((t) => t.id),
      ["a/one", "a/three"],
    );
    assert.ok(top[0].score > top[1].score);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("VectorStore persists across reload and honors hash freshness", () => {
  const dir = mkdtempSync(join(tmpdir(), "vs-"));
  try {
    const a = new VectorStore(dir, MODEL);
    a.put("a/one", "h1", vec(1, 0, 0));
    a.put("a/two", "h2", vec(0, 1, 0));

    const b = new VectorStore(dir, MODEL);
    assert.equal(b.size(), 2);
    assert.ok(b.hasFresh("a/one", "h1"));
    assert.ok(!b.hasFresh("a/one", "changed"));

    b.remove("a/one");
    const c = new VectorStore(dir, MODEL);
    assert.equal(c.size(), 1);
    assert.ok(!c.allIds().has("a/one"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("VectorStore drops sidecar on model mismatch (rebuildable)", () => {
  const dir = mkdtempSync(join(tmpdir(), "vs-"));
  try {
    const a = new VectorStore(dir, MODEL);
    a.put("a/one", "h1", vec(1, 0, 0));

    // A different model id must invalidate the derived index → empty.
    const b = new VectorStore(dir, "other-model");
    assert.equal(b.size(), 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("VectorStore treats a torn embeddings.bin as empty", () => {
  const dir = mkdtempSync(join(tmpdir(), "vs-"));
  try {
    const a = new VectorStore(dir, MODEL);
    a.put("a/one", "h1", vec(1, 0, 0));
    a.put("a/two", "h2", vec(0, 1, 0));

    // Corrupt the packed vectors so byteLength != entries*dims*4.
    const bin = join(dir, "embeddings.bin");
    writeFileSync(bin, readFileSync(bin).subarray(0, 3));

    const b = new VectorStore(dir, MODEL);
    assert.equal(b.size(), 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
