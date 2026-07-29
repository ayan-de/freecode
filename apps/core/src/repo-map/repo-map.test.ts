import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  getFileSymbols,
  queryWorkspaceSymbols,
  getProjectSymbols,
  invalidateSymbolCache,
} from "./index.js";

function fixtureProject(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fc-symbols-"));

  fs.writeFileSync(
    path.join(dir, "math.ts"),
    [
      "export function add(a: number, b: number) { return a + b; }",
      "export class Calculator { compute() { return 42; } }",
      "export interface Shape { area(): number; }",
      "export type ID = string;",
      "export const double = (x: number) => x * 2;",
    ].join("\n"),
  );

  fs.writeFileSync(
    path.join(dir, "util.js"),
    ["function helper() { return 1; }", "const arrow = () => 2;"].join("\n"),
  );

  fs.writeFileSync(
    path.join(dir, "svc.py"),
    ["def handler():\n    return 1\n", "class Service:\n    pass\n"].join("\n"),
  );

  return dir;
}

test("getFileSymbols lists a single file's top-level symbols", async () => {
  const dir = fixtureProject();
  invalidateSymbolCache(dir);
  try {
    const syms = await getFileSymbols(dir, "math.ts");
    const byName = new Map(syms.map((s) => [s.name, s.kind]));
    assert.equal(byName.get("add"), "function");
    assert.equal(byName.get("Calculator"), "class");
    assert.equal(byName.get("compute"), "method");
    assert.equal(byName.get("Shape"), "interface");
    assert.equal(byName.get("ID"), "type");
    assert.equal(byName.get("double"), "function"); // arrow-fn const

    // Python + JS files parse too.
    const py = await getFileSymbols(dir, "svc.py");
    assert.deepEqual(
      py.map((s) => `${s.name}:${s.kind}`).sort(),
      ["Service:class", "handler:function"],
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("queryWorkspaceSymbols finds symbols by name across files, ranked", async () => {
  const dir = fixtureProject();
  invalidateSymbolCache(dir);
  try {
    // Exact match ranks first.
    const add = await queryWorkspaceSymbols(dir, "add");
    assert.equal(add[0].name, "add");
    assert.equal(add[0].filePath, "math.ts");

    // Case-insensitive substring across languages.
    const calc = await queryWorkspaceSymbols(dir, "calc");
    assert.ok(calc.some((s) => s.name === "Calculator"));

    const svc = await queryWorkspaceSymbols(dir, "Service");
    assert.equal(svc[0].name, "Service");
    assert.equal(svc[0].filePath, "svc.py");

    // No match → empty.
    assert.deepEqual(await queryWorkspaceSymbols(dir, "nonexistent_xyz"), []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("getProjectSymbols returns [] for a project with no supported files", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fc-symbols-empty-"));
  invalidateSymbolCache(dir);
  try {
    fs.writeFileSync(path.join(dir, "README.md"), "# hello");
    assert.deepEqual(await getProjectSymbols(dir), []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
