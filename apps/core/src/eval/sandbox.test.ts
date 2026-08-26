import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as path from "path";
import {
  assertSafeRelativePath,
  createSandbox,
  insideSandbox,
  SandboxError,
} from "./sandbox.js";

test("seeds files, including nested ones", () => {
  const sandbox = createSandbox({
    "calc.mjs": "export const add = (a, b) => a + b;\n",
    "src/config.mjs": "export const port = 8080;\n",
  });
  try {
    assert.equal(
      fs.readFileSync(path.join(sandbox.dir, "calc.mjs"), "utf-8"),
      "export const add = (a, b) => a + b;\n",
    );
    assert.ok(fs.existsSync(path.join(sandbox.dir, "src/config.mjs")));
  } finally {
    sandbox.cleanup();
  }
});

test("cleanup removes the directory", () => {
  const sandbox = createSandbox({ "a.mjs": "" });
  sandbox.cleanup();
  assert.equal(fs.existsSync(sandbox.dir), false);
});

test("refuses a path that escapes the sandbox", () => {
  // The whole point of the tmpdir is that a case cannot reach the real tree.
  assert.throws(
    () => assertSafeRelativePath("../../etc/passwd", "case"),
    (e: Error) => e instanceof SandboxError && /escapes the sandbox/.test(e.message),
  );
  assert.throws(
    () => assertSafeRelativePath("/etc/passwd", "case"),
    (e: Error) => e instanceof SandboxError && /must be relative/.test(e.message),
  );
});

test("createSandbox leaves nothing behind when seeding fails", () => {
  let leaked: string | undefined;
  assert.throws(() => {
    const sandbox = createSandbox({ "../escape.mjs": "" });
    leaked = sandbox.dir;
  });
  assert.equal(leaked, undefined);
});

test("insideSandbox judges relative and absolute targets", () => {
  const dir = "/tmp/freecode-eval-x";
  assert.equal(insideSandbox(dir, "calc.mjs"), true);
  assert.equal(insideSandbox(dir, "src/deep/calc.mjs"), true);
  assert.equal(insideSandbox(dir, `${dir}/calc.mjs`), true);
  assert.equal(insideSandbox(dir, "../elsewhere.mjs"), false);
  assert.equal(insideSandbox(dir, "/etc/passwd"), false);
});
