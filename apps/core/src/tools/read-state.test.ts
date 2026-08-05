import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm, utimes } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { ReadTool } from "./read.js";
import { EditTool } from "./edit.js";
import {
  getReadState,
  disposeReadState,
  canDedup,
  markReadPruned,
} from "./read-state.js";

const base = { mtimeMs: 100, size: 10, offset: 1, limit: 2000 };
const record = (over = {}) => ({ ...base, inContext: true, ...over });

test("canDedup requires an exact, unchanged, in-context match", () => {
  assert.equal(canDedup(record(), base), true);
  assert.equal(canDedup(undefined, base), false);
  assert.equal(canDedup(record({ mtimeMs: 999 }), base), false, "mtime moved");
  assert.equal(canDedup(record({ size: 999 }), base), false, "size changed");
  assert.equal(canDedup(record({ offset: 50 }), base), false, "other window");
  assert.equal(canDedup(record({ limit: 50 }), base), false, "other limit");
});

test("FREECODE_READ_DEDUP=0 disables dedup entirely", () => {
  const original = process.env.FREECODE_READ_DEDUP;
  try {
    process.env.FREECODE_READ_DEDUP = "0";
    assert.equal(canDedup(record(), base), false);
    process.env.FREECODE_READ_DEDUP = "1";
    assert.equal(
      canDedup(record(), base),
      true,
      "any other value leaves it on",
    );
  } finally {
    if (original === undefined) delete process.env.FREECODE_READ_DEDUP;
    else process.env.FREECODE_READ_DEDUP = original;
  }
});

test("a record written by edit/write is never deduped against", () => {
  // No offset means the model was never shown this content — the transcript
  // holds the pre-edit text, so "you already have this" would be a lie.
  const written = { mtimeMs: 100, size: 10, inContext: true };
  assert.equal(canDedup(written, base), false);
});

test("pruned content is no longer deduped against", () => {
  const state = getReadState("s-prune");
  state.set("/f.ts", record());
  assert.equal(canDedup(state.get("/f.ts"), base), true);

  markReadPruned("s-prune", "/f.ts");
  assert.equal(
    canDedup(state.get("/f.ts"), base),
    false,
    "the copy it would point at has been replaced with a marker",
  );
  disposeReadState("s-prune");
});

test("read dedups an unchanged re-read, and re-sends a changed file", async () => {
  const dir = await mkdtemp(join(tmpdir(), "freecode-readstate-"));
  const file = join(dir, "a.ts");
  await writeFile(file, "const a = 1;\nconst b = 2;\n");
  const ctx = { cwd: dir, sessionId: "s-read" };

  const first = await ReadTool.execute({ filePath: file }, ctx as never);
  assert.ok(first.success && first.result.output.includes("const a = 1;"));

  const second = await ReadTool.execute({ filePath: file }, ctx as never);
  assert.ok(second.success);
  assert.ok(
    second.result.output.includes("byte-for-byte identical"),
    "unchanged re-read should not resend the body",
  );
  assert.ok(!second.result.output.includes("const a = 1;"));

  // Change it on disk — the model must get the real content back.
  await writeFile(file, "const a = 99;\n");
  const third = await ReadTool.execute({ filePath: file }, ctx as never);
  assert.ok(third.success && third.result.output.includes("const a = 99;"));

  disposeReadState("s-read");
  await rm(dir, { recursive: true, force: true });
});

test("a file never read this session is never deduped", async () => {
  const dir = await mkdtemp(join(tmpdir(), "freecode-readstate-"));
  const file = join(dir, "fresh.ts");
  await writeFile(file, "export const x = 1;\n");

  const result = await ReadTool.execute({ filePath: file }, {
    cwd: dir,
    sessionId: "s-fresh",
  } as never);
  assert.ok(result.success && result.result.output.includes("export const x"));

  disposeReadState("s-fresh");
  await rm(dir, { recursive: true, force: true });
});

test("edit warns when the file changed since the model read it", async () => {
  const dir = await mkdtemp(join(tmpdir(), "freecode-readstate-"));
  const file = join(dir, "b.ts");
  await writeFile(file, "let v = 1;\n");
  const ctx = { cwd: dir, sessionId: "s-edit" };

  await ReadTool.execute({ filePath: file }, ctx as never);

  // Something else touches the file after the model read it.
  const future = new Date(Date.now() + 10_000);
  await utimes(file, future, future);

  const edited = await EditTool.execute(
    { filePath: file, oldString: "let v = 1;", newString: "let v = 2;" },
    ctx as never,
  );
  assert.ok(edited.success);
  assert.ok(
    edited.result.output.includes("changed on disk since you last read it"),
    "editing against unseen content should warn",
  );

  disposeReadState("s-edit");
  await rm(dir, { recursive: true, force: true });
});

test("the model's own edit does not warn on the next edit", async () => {
  const dir = await mkdtemp(join(tmpdir(), "freecode-readstate-"));
  const file = join(dir, "c.ts");
  await writeFile(file, "let v = 1;\n");
  const ctx = { cwd: dir, sessionId: "s-own" };

  await ReadTool.execute({ filePath: file }, ctx as never);
  await EditTool.execute(
    { filePath: file, oldString: "let v = 1;", newString: "let v = 2;" },
    ctx as never,
  );
  const second = await EditTool.execute(
    { filePath: file, oldString: "let v = 2;", newString: "let v = 3;" },
    ctx as never,
  );

  assert.ok(second.success);
  assert.ok(
    !second.result.output.includes("changed on disk"),
    "an edit must not flag the agent's own previous edit as external",
  );

  disposeReadState("s-own");
  await rm(dir, { recursive: true, force: true });
});
