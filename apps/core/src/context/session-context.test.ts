import test from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "os";
import { mkdtempSync, writeFileSync } from "fs";
import { join } from "path";
import {
  getFrozenSessionContext,
  disposeFrozenSessionContext,
} from "./session-context.js";
import {
  getProjectContext,
  invalidateProjectContext,
} from "./tree-cache.js";
import { PromptCompiler } from "./compiler.js";

test("freezes tree across tree-cache invalidation for the same session", () => {
  const dir = mkdtempSync(join(tmpdir(), "fc-session-tree-"));
  writeFileSync(join(dir, "a.txt"), "a");
  const sessionId = "sess-freeze-1";
  disposeFrozenSessionContext(sessionId);

  const first = getFrozenSessionContext(sessionId, dir);
  assert.match(first.ctx.tree, /a\.txt/);

  writeFileSync(join(dir, "b.txt"), "b");
  invalidateProjectContext(dir);
  // Process cache sees the new file…
  assert.match(getProjectContext(dir).tree, /b\.txt/);
  // …but the session freeze does not.
  const second = getFrozenSessionContext(sessionId, dir);
  assert.equal(second, first);
  assert.doesNotMatch(second.ctx.tree, /b\.txt/);

  disposeFrozenSessionContext(sessionId);
});

test("dispose clears the freeze so the next get re-snapshots", () => {
  const dir = mkdtempSync(join(tmpdir(), "fc-session-tree-"));
  writeFileSync(join(dir, "a.txt"), "a");
  const sessionId = "sess-freeze-2";
  disposeFrozenSessionContext(sessionId);

  const first = getFrozenSessionContext(sessionId, dir);
  writeFileSync(join(dir, "b.txt"), "b");
  invalidateProjectContext(dir);
  disposeFrozenSessionContext(sessionId);

  const fresh = getFrozenSessionContext(sessionId, dir);
  assert.notEqual(fresh, first);
  assert.match(fresh.ctx.tree, /b\.txt/);

  disposeFrozenSessionContext(sessionId);
});

test("clock is frozen with the tree, not recomputed later", () => {
  const dir = mkdtempSync(join(tmpdir(), "fc-session-tree-"));
  const sessionId = "sess-freeze-3";
  disposeFrozenSessionContext(sessionId);

  const t0 = new Date("2026-08-08T12:30:00.000Z");
  const t1 = new Date("2026-08-08T14:45:00.000Z");
  const first = getFrozenSessionContext(sessionId, dir, t0);
  assert.equal(first.clock, "2026-08-08T12:00:00Z");

  const second = getFrozenSessionContext(sessionId, dir, t1);
  assert.equal(second.clock, "2026-08-08T12:00:00Z");

  disposeFrozenSessionContext(sessionId);
});

test("projectPath change re-freezes for the new path", () => {
  const dirA = mkdtempSync(join(tmpdir(), "fc-session-a-"));
  const dirB = mkdtempSync(join(tmpdir(), "fc-session-b-"));
  writeFileSync(join(dirA, "a.txt"), "a");
  writeFileSync(join(dirB, "b.txt"), "b");
  const sessionId = "sess-freeze-4";
  disposeFrozenSessionContext(sessionId);

  const a = getFrozenSessionContext(sessionId, dirA);
  assert.match(a.ctx.tree, /a\.txt/);

  const b = getFrozenSessionContext(sessionId, dirB);
  assert.notEqual(b, a);
  assert.match(b.ctx.tree, /b\.txt/);

  disposeFrozenSessionContext(sessionId);
});

test("compileDynamicContext reuses an explicit clock", () => {
  const compiler = new PromptCompiler("/proj", "proj", "build");
  const text = compiler.compileDynamicContext(
    "📄 a.txt",
    "abc12345",
    "",
    undefined,
    "2026-08-08T12:00:00Z",
  );
  assert.ok(text.includes("Current Time: 2026-08-08T12:00:00Z"));
});
