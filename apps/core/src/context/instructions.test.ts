import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { compileInstructionsSection } from "./instructions.js";

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "fc-instr-"));
}

test("returns empty string when no instruction files exist", () => {
  const project = tmpDir();
  const global = tmpDir();
  assert.equal(compileInstructionsSection(project, global), "");
});

test("loads AGENTS.md from project root when it is the only file", () => {
  const project = tmpDir();
  const global = tmpDir();
  fs.writeFileSync(path.join(project, "AGENTS.md"), "use tabs");
  const section = compileInstructionsSection(project, global);
  assert.ok(section.includes("use tabs"));
  assert.ok(section.includes(`Instructions from: ${path.join(project, "AGENTS.md")}`));
});

test("CLAUDE.md takes precedence over AGENTS.md in the same directory", () => {
  const project = tmpDir();
  const global = tmpDir();
  fs.writeFileSync(path.join(project, "CLAUDE.md"), "claude rules");
  fs.writeFileSync(path.join(project, "AGENTS.md"), "agents rules");
  const section = compileInstructionsSection(project, global);
  assert.ok(section.includes("claude rules"));
  assert.ok(!section.includes("agents rules"));
});

test("global instructions come before project instructions", () => {
  const project = tmpDir();
  const global = tmpDir();
  fs.writeFileSync(path.join(global, "AGENTS.md"), "GLOBAL-MARK");
  fs.writeFileSync(path.join(project, "CLAUDE.md"), "PROJECT-MARK");
  const section = compileInstructionsSection(project, global);
  assert.ok(section.indexOf("GLOBAL-MARK") < section.indexOf("PROJECT-MARK"));
});

test("empty or whitespace-only file is skipped, falls through to AGENTS.md", () => {
  const project = tmpDir();
  const global = tmpDir();
  fs.writeFileSync(path.join(project, "CLAUDE.md"), "   \n");
  fs.writeFileSync(path.join(project, "AGENTS.md"), "fallback rules");
  const section = compileInstructionsSection(project, global);
  assert.ok(section.includes("fallback rules"));
});

test("section is truncated at 40000 characters with a marker", () => {
  const project = tmpDir();
  const global = tmpDir();
  fs.writeFileSync(path.join(project, "CLAUDE.md"), "x".repeat(50_000));
  const section = compileInstructionsSection(project, global);
  assert.ok(section.length < 41_000);
  assert.ok(section.includes("[Instructions truncated"));
});
