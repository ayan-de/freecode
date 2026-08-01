import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";
import { loadCommands, resolveUserCommand } from "./loader.js";

function withTestDir(run: (testDir: string) => Promise<void> | void): Promise<void> {
  const testDir = fs.mkdtempSync(path.join(os.tmpdir(), "freecode-commands-test-"));
  return Promise.resolve(run(testDir)).finally(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });
}

function writeCommand(
  projectDir: string,
  name: string,
  content: string,
): void {
  const commandDir = path.join(projectDir, ".freecode", "commands", name);
  fs.mkdirSync(commandDir, { recursive: true });
  fs.writeFileSync(path.join(commandDir, "command.md"), content);
}

test("loads command metadata from the project directory", async () =>
  withTestDir(async (testDir) => {
    const projectDir = path.join(testDir, "project");
    writeCommand(
      projectDir,
      "review",
      `---
name: review
description: Run code review
argHint: [files]
---
Review the following code:
{{args}}`,
    );

    const commands = await loadCommands({ projectPath: projectDir, homeDir: path.join(testDir, "home") });
    assert.equal(commands.length, 1);
    assert.deepEqual(
      { name: commands[0].name, description: commands[0].description, argHint: commands[0].argHint },
      { name: "review", description: "Run code review", argHint: "[files]" },
    );
  }),
);

test("resolves args, cwd, and positional argument placeholders", async () =>
  withTestDir(async (testDir) => {
    const projectDir = path.join(testDir, "project");
    writeCommand(
      projectDir,
      "review",
      `---
name: review
---
{{cwd}}: {{args}} ({{arg1}}, {{arg2}})`,
    );
    const [command] = await loadCommands({ projectPath: projectDir, homeDir: path.join(testDir, "home") });
    assert.equal(
      resolveUserCommand(command, { cwd: "/my/project", args: ["one", "two"] }),
      "/my/project: one two (one, two)",
    );
  }),
);

test("returns no commands for absent command directories", async () =>
  withTestDir(async (testDir) => {
    assert.deepEqual(
      await loadCommands({ projectPath: path.join(testDir, "project"), homeDir: path.join(testDir, "home") }),
      [],
    );
  }),
);

test("loads project commands before identically named user commands", async () =>
  withTestDir(async (testDir) => {
    const projectDir = path.join(testDir, "project");
    const homeDir = path.join(testDir, "home");
    writeCommand(projectDir, "test", "---\nname: test\ndescription: Project command\n---\nproject");
    writeCommand(homeDir, "test", "---\nname: test\ndescription: User command\n---\nuser");

    const commands = await loadCommands({ projectPath: projectDir, homeDir });
    assert.equal(commands.length, 2);
    assert.deepEqual(
      { scope: commands[0].scope, description: commands[0].description },
      { scope: "project", description: "Project command" },
    );
  }),
);

test("uses the directory name and default description without frontmatter", async () =>
  withTestDir(async (testDir) => {
    const projectDir = path.join(testDir, "project");
    writeCommand(projectDir, "simple", "This is a simple command.");
    const [command] = await loadCommands({ projectPath: projectDir, homeDir: path.join(testDir, "home") });
    assert.deepEqual(
      { name: command.name, description: command.description, content: command.content },
      { name: "simple", description: "Run the simple command", content: "This is a simple command." },
    );
  }),
);
