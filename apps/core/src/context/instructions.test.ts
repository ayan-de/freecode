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
  assert.ok(
    section.includes(`Instructions from: ${path.join(project, "AGENTS.md")}`),
  );
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

test("an oversized file is truncated with a marker naming it", () => {
  const project = tmpDir();
  const global = tmpDir();
  fs.writeFileSync(path.join(project, "CLAUDE.md"), "x".repeat(50_000));
  const section = compileInstructionsSection(project, global);
  assert.ok(section.length < 41_000);
  assert.match(section, /\[Truncated: .*CLAUDE\.md did not fit/);
});

test("a fat global file cannot push the project's instructions out", () => {
  // The regression this guards: blocks were joined global-first and the JOINED
  // string was sliced at the cap, so a global file at the budget deleted the
  // repo's own instructions entirely — mid-sentence, and silently.
  const project = tmpDir();
  const global = tmpDir();
  fs.writeFileSync(path.join(global, "CLAUDE.md"), "g".repeat(50_000));
  fs.writeFileSync(
    path.join(project, "CLAUDE.md"),
    "PROJECT-MARK: the rule that must survive",
  );

  const section = compileInstructionsSection(project, global);
  assert.match(section, /PROJECT-MARK: the rule that must survive/);
  // And the global one is still present, just cut — not dropped without trace.
  assert.match(section, /\[Truncated: .*CLAUDE\.md did not fit/);
  assert.ok(section.includes("gggg"));
});

test("prompt order stays global-then-project even when the global was cut", () => {
  const project = tmpDir();
  const global = tmpDir();
  fs.writeFileSync(
    path.join(global, "CLAUDE.md"),
    "GLOBAL-MARK" + "g".repeat(50_000),
  );
  fs.writeFileSync(path.join(project, "CLAUDE.md"), "PROJECT-MARK");
  const section = compileInstructionsSection(project, global);
  assert.ok(section.indexOf("GLOBAL-MARK") < section.indexOf("PROJECT-MARK"));
});

test("a project file that alone exceeds the budget squeezes the global out loudly", () => {
  const project = tmpDir();
  const global = tmpDir();
  fs.writeFileSync(path.join(global, "CLAUDE.md"), "GLOBAL-MARK");
  fs.writeFileSync(path.join(project, "CLAUDE.md"), "p".repeat(50_000));

  const section = compileInstructionsSection(project, global);
  assert.match(section, /\[Omitted: the 40000-character instruction budget/);
  // Named, so an unfollowed global rule has a visible cause.
  assert.match(section, /Instructions from: .*CLAUDE\.md/);
  assert.ok(!section.includes("GLOBAL-MARK"));
});

test("two files that fit together are both kept whole", () => {
  const project = tmpDir();
  const global = tmpDir();
  fs.writeFileSync(path.join(global, "CLAUDE.md"), "GLOBAL-MARK");
  fs.writeFileSync(path.join(project, "CLAUDE.md"), "PROJECT-MARK");
  const section = compileInstructionsSection(project, global);
  assert.ok(section.includes("GLOBAL-MARK"));
  assert.ok(section.includes("PROJECT-MARK"));
  assert.ok(!section.includes("Truncated"));
  assert.ok(!section.includes("Omitted"));
});
