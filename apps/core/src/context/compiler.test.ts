import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { PromptCompiler } from "./compiler.js";
import { loadSystemPrompt } from "../session/prompt.js";

// Isolate tests from the developer's real ~/.freecode instruction files:
// os.homedir() honors HOME (POSIX) / USERPROFILE (Windows) at call time.
process.env.HOME = fs.mkdtempSync(path.join(os.tmpdir(), "fc-home-"));
process.env.USERPROFILE = process.env.HOME;

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "fc-compiler-"));
}

test("compileSystemBlocks includes project CLAUDE.md in the static block", async () => {
  const project = tmpDir();
  fs.writeFileSync(path.join(project, "CLAUDE.md"), "ALWAYS-USE-SPACES-MARKER");
  const compiler = new PromptCompiler(project, "test-project", "build");
  const blocks = await compiler.compileSystemBlocks("mock-provider-a");
  assert.equal(blocks[0].cache, true);
  assert.ok(blocks[0].text.includes("ALWAYS-USE-SPACES-MARKER"));
  assert.ok(blocks[0].text.includes("Instructions from:"));
});

test("compileSystemBlocks works unchanged when no instruction files exist", async () => {
  const project = tmpDir();
  const compiler = new PromptCompiler(project, "test-project", "build");
  const blocks = await compiler.compileSystemBlocks("mock-provider-b");
  assert.equal(blocks.length, 1);
  assert.ok(!blocks[0].text.includes("Instructions from:"));
});

test("compileSystemBlocks starts the static block with the system prompt", async () => {
  const project = tmpDir();
  const compiler = new PromptCompiler(project, "test-project", "build");
  const blocks = await compiler.compileSystemBlocks(
    "mock-provider-c",
    "claude-sonnet",
  );
  const expected = (await loadSystemPrompt()).trim();
  assert.ok(expected.length > 0);
  assert.ok(blocks[0].text.startsWith(expected.slice(0, 40)));
});

test("compileSystemBlocks uses one system prompt regardless of model", async () => {
  const project = tmpDir();
  const compiler = new PromptCompiler(project, "test-project", "build");
  const lead = (await loadSystemPrompt()).trim().slice(0, 40);
  for (const model of ["claude-sonnet", "gpt-4o", "gemini-2.5-pro"]) {
    const blocks = await compiler.compileSystemBlocks("mock-provider", model);
    // Same base prompt for every model...
    assert.ok(blocks[0].text.startsWith(lead));
    // ...but grounded with that model's identity to avoid misidentification.
    assert.ok(blocks[0].text.includes(`powered by the model named ${model}`));
  }
});

test("the static block is exactly the join of its named segments", async () => {
  // The `/context` breakdown attributes tokens per segment and reports their
  // sum as the static block's size. If the block were assembled any other way
  // that sum would silently stop matching what is sent.
  const project = tmpDir();
  fs.writeFileSync(path.join(project, "CLAUDE.md"), "SEGMENT-JOIN-MARKER");
  const compiler = new PromptCompiler(project, "test-project", "plan");

  const segments = await compiler.buildStaticSegments("mock-provider-a", "m-1");
  const blocks = await compiler.compileSystemBlocks("mock-provider-a", "m-1");

  assert.equal(
    blocks[0].text,
    segments
      .map((s) => s.text)
      .filter((t) => t.length > 0)
      .join("\n\n"),
  );
  assert.deepEqual(
    segments.map((s) => s.id),
    ["system-prompt", "project-instructions", "skills", "memory-guidance"],
  );
});

test("an absent section yields an empty segment, not a blank gap", async () => {
  // No CLAUDE.md and (in an empty project) no skills: those segments must come
  // back empty so the breakdown omits them, and the join must not leave the
  // double newlines that would shift every byte after it.
  const project = tmpDir();
  const compiler = new PromptCompiler(project, "test-project", "build");

  const segments = await compiler.buildStaticSegments("mock-provider-a");
  const instructions = segments.find((s) => s.id === "project-instructions");
  assert.equal(instructions?.text, "");

  const blocks = await compiler.compileSystemBlocks("mock-provider-a");
  assert.ok(!blocks[0].text.includes("\n\n\n"));
});
