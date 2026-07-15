import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { PromptCompiler } from "./compiler.js";
import { loadProviderPrompt } from "../session/prompt.js";

// Isolate tests from the developer's real ~/.freecode instruction files:
// os.homedir() honors HOME (POSIX) / USERPROFILE (Windows) at call time.
process.env.HOME = fs.mkdtempSync(path.join(os.tmpdir(), "fc-home-"));
process.env.USERPROFILE = process.env.HOME;

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "fc-compiler-"));
}

test("compileSystemBlocks includes project CLAUDE.md in the static block", () => {
  const project = tmpDir();
  fs.writeFileSync(
    path.join(project, "CLAUDE.md"),
    "ALWAYS-USE-SPACES-MARKER",
  );
  const compiler = new PromptCompiler(project, "test-project", "build");
  const blocks = compiler.compileSystemBlocks(
    "src/",
    "abc123",
    "",
    "mock-provider-a",
  );
  assert.equal(blocks[0].cache, true);
  assert.ok(blocks[0].text.includes("ALWAYS-USE-SPACES-MARKER"));
  assert.ok(blocks[0].text.includes("Instructions from:"));
});

test("compileSystemBlocks works unchanged when no instruction files exist", () => {
  const project = tmpDir();
  const compiler = new PromptCompiler(project, "test-project", "build");
  const blocks = compiler.compileSystemBlocks(
    "src/",
    "abc123",
    "",
    "mock-provider-b",
  );
  assert.equal(blocks.length, 2);
  assert.ok(!blocks[0].text.includes("Instructions from:"));
});

test("compileSystemBlocks starts the static block with the provider prompt", () => {
  const project = tmpDir();
  const compiler = new PromptCompiler(project, "test-project", "build");
  const blocks = compiler.compileSystemBlocks(
    "src/",
    "abc123",
    "",
    "mock-provider-c",
    "claude-sonnet",
  );
  const expected = loadProviderPrompt("claude-sonnet").trim();
  assert.ok(expected.length > 0);
  assert.ok(blocks[0].text.startsWith(expected.slice(0, 40)));
});

test("compileSystemBlocks falls back to the provider id when model is undefined", () => {
  const project = tmpDir();
  const compiler = new PromptCompiler(project, "test-project", "build");
  const blocks = compiler.compileSystemBlocks(
    "src/",
    "abc123",
    "",
    "chatgpt",
  );
  const expected = loadProviderPrompt("chatgpt").trim();
  assert.ok(expected.length > 0);
  assert.ok(blocks[0].text.startsWith(expected.slice(0, 40)));
  // Pins the routing fix: "chatgpt" must resolve to chatgpt.txt, not openai.txt
  const openaiPrompt = loadProviderPrompt("gpt").trim();
  assert.notEqual(expected.slice(0, 200), openaiPrompt.slice(0, 200));
});
