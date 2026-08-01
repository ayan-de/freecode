# User-Defined Slash Commands Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow users to define custom slash commands (e.g., `/review`, `/test`, `/deploy`) via markdown files in `.freecode/commands/` and `~/.freecode/commands/`, mirroring Claude Code's custom commands pattern.

**Architecture:** Extend the existing commands system in `apps/core/src/commands/` to:
1. Keep built-in commands (currently hardcoded in `registry.ts`)
2. Add dynamic loading from file system paths (project + user)
3. Use YAML frontmatter for command metadata, body as the prompt template

**Tech Stack:** TypeScript, fast-glob, existing FreeCode patterns (skills loader as reference)

---

## File Structure

```
apps/core/src/commands/
├── registry.ts          # MODIFY: Add dynamic loader, keep built-in registration
├── types.ts             # MODIFY: Add CommandScope type for loader
├── loader.ts            # NEW: Parse .md files from commands/ dirs
└── templates/           # EXISTING: Keep built-in templates
```

---

## Global Constraints

- Must work with existing `CommandInfo` interface (no breaking changes)
- Commands loaded from filesystem must be compatible with existing `commands.list` / `commands.resolve` IPC
- Must follow FreeCode's pattern for config paths: `~/.freecode/commands/` (user) and `{project}/.freecode/commands/` (project)
- **Precedence: Project > User > Built-in** (project commands can override built-ins like `/init`)
- Must handle missing directories gracefully (no error if commands/ doesn't exist)

---

## Tasks

### Task 0: Pre-flight — verify existing types

**Files:**
- Check: `apps/core/src/commands/types.ts`

- [ ] **Step 1: Check if CommandResolveContext exists**

Run: `grep -n "CommandResolveContext" apps/core/src/commands/types.ts`

- If found: Note the line number, you'll use it in Task 2
- If not found: Add this interface to Task 1

---

### Task 1: Add CommandScope type and command file parser

**Files:**
- Modify: `apps/core/src/commands/types.ts`

**Interfaces:**
- Produces: `CommandScope` type, `UserCommand` interface, `CommandResolveContext` (if missing)

- [ ] **Step 1: Add CommandScope and UserCommand types to types.ts**

Add after line 23 (after `PromptCommand` interface):

```typescript
/** Scope where a command is defined. */
export type CommandScope = "builtin" | "user" | "project";

/** Context for resolving a user command. */
export interface CommandResolveContext {
  cwd: string;
  args: string[];
}

/** A user-defined command loaded from filesystem. */
export interface UserCommand {
  name: string;
  description: string;
  argHint?: string;
  /** The prompt template body. */
  content: string;
  scope: CommandScope;
  /** File path where this command is defined. */
  location: string;
}
```

- [ ] **Step 2: Verify file compiles**

Run: `cd apps/core && npx tsc --noEmit src/commands/types.ts`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add apps/core/src/commands/types.ts
git commit -m "feat(commands): add CommandScope and UserCommand types"
```

---

### Task 2: Create the command file loader

**Files:**
- Create: `apps/core/src/commands/loader.ts`

**Interfaces:**
- Consumes: `CommandResolveContext` (from types.ts), project path, home dir
- Produces: `loadCommands()` function, `parseCommandFile()` function, `resolveUserCommand()` function

- [ ] **Step 1: Write the loader module**

Create `apps/core/src/commands/loader.ts`:

```typescript
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import fg from "fast-glob";
import type { UserCommand, CommandScope, CommandResolveContext } from "./types.js";
import { logger } from "../utils/logger.js";

const COMMAND_FILENAME = "command.md";
const FRONTMATTER_REGEX = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/;

// ============================================================================
// YAML Frontmatter Parser (mirrors skills/loader.ts)
// ============================================================================

function parseFrontmatter(
  content: string,
): { metadata: Record<string, string>; body: string } | null {
  const match = content.match(FRONTMATTER_REGEX);
  if (!match) return null;

  const frontmatterStr = match[1];
  const body = match[2].trim();

  const metadata: Record<string, string> = {};
  for (const line of frontmatterStr.split("\n")) {
    const colonIndex = line.indexOf(":");
    if (colonIndex === -1) continue;
    const key = line.slice(0, colonIndex).trim();
    const value = line
      .slice(colonIndex + 1)
      .trim()
      .replace(/^["']|["']$/g, "");
    metadata[key] = value;
  }

  return { metadata, body };
}

// ============================================================================
// Command File Parser
// ============================================================================

function parseCommandFile(filePath: string, scope: CommandScope): UserCommand | null {
  let content: string;
  try {
    content = fs.readFileSync(filePath, "utf-8");
  } catch (error) {
    logger.warn(`[CommandsLoader] Failed to read ${filePath}: ${error}`);
    return null;
  }

  const dirName = path.basename(path.dirname(filePath));
  const parsed = parseFrontmatter(content);

  // No frontmatter — fall back to the containing directory name.
  if (!parsed) {
    return {
      name: dirName,
      description: `Run the ${dirName} command`,
      content: content.trim(),
      scope,
      location: filePath,
    };
  }

  const { metadata, body } = parsed;
  const name = metadata.name || dirName;

  return {
    name,
    description: metadata.description || `Run the ${name} command`,
    argHint: metadata.argHint,
    content: body,
    scope,
    location: filePath,
  };
}

// ============================================================================
// Path Builders
// ============================================================================

/** Glob pattern for <base>/<name>/command.md */
function commandGlob(base: string): string {
  return path.join(base, "*", COMMAND_FILENAME);
}

// ============================================================================
// Main Loader
// ============================================================================

export interface LoaderOptions {
  projectPath: string;
  homeDir?: string;
}

/**
 * Load all user-defined commands from project and user directories.
 * Search order (first found wins):
 *   1. Project: {projectPath}/.freecode/commands/
 *   2. User: ~/.freecode/commands/
 *
 * Returns commands in precedence order (project first, then user).
 */
export async function loadCommands(opts: LoaderOptions): Promise<UserCommand[]> {
  const home = opts.homeDir || os.homedir();
  const commands: UserCommand[] = [];

  // Project-scoped commands (higher precedence)
  const projectCommandsDir = path.join(opts.projectPath, ".freecode", "commands");
  if (fs.existsSync(projectCommandsDir)) {
    const projectPatterns = [commandGlob(projectCommandsDir)];
    const projectMatches = await fg(projectPatterns, {
      absolute: true,
      onlyFiles: true,
      suppressErrors: true,
    });
    for (const filePath of projectMatches) {
      const cmd = parseCommandFile(filePath, "project");
      if (cmd) commands.push(cmd);
    }
  }

  // User-scoped commands (lower precedence)
  const userCommandsDir = path.join(home, ".freecode", "commands");
  if (fs.existsSync(userCommandsDir)) {
    const userPatterns = [commandGlob(userCommandsDir)];
    const userMatches = await fg(userPatterns, {
      absolute: true,
      onlyFiles: true,
      suppressErrors: true,
    });
    for (const filePath of userMatches) {
      const cmd = parseCommandFile(filePath, "user");
      if (cmd) commands.push(cmd);
    }
  }

  return commands;
}

/**
 * Resolve a user command to its prompt string.
 * Supports {{args}}, {{cwd}}, {{arg1}}, {{arg2}}, etc.
 */
export function resolveUserCommand(
  cmd: UserCommand,
  ctx: CommandResolveContext,
): string {
  let prompt = cmd.content;

  // Replace {{args}} with the provided args (joined as string)
  prompt = prompt.replace(/\{\{args\}\}/g, ctx.args.join(" "));

  // Replace {{cwd}} with the current working directory
  prompt = prompt.replace(/\{\{cwd\}\}/g, ctx.cwd);

  // Replace {{arg1}}, {{arg2}}, etc. with individual args
  ctx.args.forEach((arg, index) => {
    prompt = prompt.replace(new RegExp(`\\{\\{arg${index + 1}\\}\\}`, "g"), arg);
  });

  return prompt;
}
```

- [ ] **Step 2: Verify file compiles**

Run: `cd apps/core && npx tsc --noEmit src/commands/loader.ts`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add apps/core/src/commands/loader.ts
git commit -m "feat(commands): add loader for user-defined commands"
```

---

### Task 3: Integrate loader into registry

**Files:**
- Modify: `apps/core/src/commands/registry.ts`

**Interfaces:**
- Consumes: `loadCommands()` from loader.ts
- Produces: Updated `listCommandInfos()`, `resolveCommand()` functions

**Critical: Precedence is Project > User > Built-in**

- [ ] **Step 1: Update registry.ts to use the loader**

Replace the entire file content:

```typescript
import type { CommandInfo } from "@thisisayande/freecode-shared";
import type { PromptCommand, CommandResolveContext, UserCommand } from "./types.js";
import { initTemplate } from "./templates/init.js";
import { loadCommands, resolveUserCommand } from "./loader.js";

// Built-in prompt commands. Add new entries here — every frontend picks them up
// via IPC (commands.list / commands.resolve). No frontend changes required.
const builtinCommands = new Map<string, PromptCommand>();

function registerBuiltin(cmd: PromptCommand): void {
  builtinCommands.set(cmd.name, cmd);
}

registerBuiltin({
  name: "init",
  description: "Analyze the repo and generate AGENTS.md / CLAUDE.md",
  argHint: "[focus]",
  template: initTemplate,
});

// In-memory cache of loaded user commands (refreshed on demand)
let userCommandsCache: UserCommand[] | null = null;
let lastLoadedProjectPath: string | null = null;

/** Load and cache user commands for a project. */
async function ensureUserCommandsLoaded(projectPath: string): Promise<void> {
  if (userCommandsCache && lastLoadedProjectPath === projectPath) {
    return;
  }
  userCommandsCache = await loadCommands({ projectPath });
  lastLoadedProjectPath = projectPath;
}

/** Clear the user commands cache (useful for testing). */
export function clearCommandsCache(): void {
  userCommandsCache = null;
  lastLoadedProjectPath = null;
}

/** Metadata for every prompt command (for autocomplete / menus). */
export function listCommandInfos(): CommandInfo[] {
  // Use a Map to handle precedence correctly: later inserts overwrite earlier ones
  // Order: builtin → user → project (project wins on name collision)
  const commandMap = new Map<string, CommandInfo>();

  // Built-in commands (lowest precedence)
  for (const c of builtinCommands.values()) {
    commandMap.set(c.name, {
      name: c.name,
      description: c.description,
      argHint: c.argHint,
    });
  }

  // User commands (medium precedence - overwrite builtins)
  if (userCommandsCache) {
    for (const c of userCommandsCache.filter(cmd => cmd.scope === "user")) {
      commandMap.set(c.name, {
        name: c.name,
        description: c.description,
        argHint: c.argHint,
      });
    }
  }

  // Project commands (highest precedence - overwrite user/builtin)
  if (userCommandsCache) {
    for (const c of userCommandsCache.filter(cmd => cmd.scope === "project")) {
      commandMap.set(c.name, {
        name: c.name,
        description: c.description,
        argHint: c.argHint,
      });
    }
  }

  return Array.from(commandMap.values());
}

/**
 * Resolve a command to the prompt string sent to the agent, or null if unknown.
 * Precedence: Project > User > Built-in
 */
export async function resolveCommand(
  name: string,
  args: string[],
  cwd: string,
  projectPath: string,
): Promise<string | null> {
  // Load user commands first (project and user)
  await ensureUserCommandsLoaded(projectPath);

  // Check project commands (highest precedence)
  if (userCommandsCache) {
    const projectCmd = userCommandsCache.find(
      (c) => c.scope === "project" && c.name === name
    );
    if (projectCmd) {
      return resolveUserCommand(projectCmd, { cwd, args });
    }
  }

  // Check user commands (medium precedence)
  if (userCommandsCache) {
    const userCmd = userCommandsCache.find(
      (c) => c.scope === "user" && c.name === name
    );
    if (userCmd) {
      return resolveUserCommand(userCmd, { cwd, args });
    }
  }

  // Check built-in commands (lowest precedence)
  const builtin = builtinCommands.get(name);
  if (builtin) {
    return builtin.template({ cwd, args });
  }

  return null;
}

/** Get all loaded user commands (for debugging/inspection). */
export function getUserCommands(): UserCommand[] {
  return userCommandsCache || [];
}
```

- [ ] **Step 2: Verify file compiles**

Run: `cd apps/core && npx tsc --noEmit src/commands/registry.ts`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add apps/core/src/commands/registry.ts
git commit -m "feat(commands): integrate user-defined commands loader"
```

---

### Task 4: Update server.ts to use async resolveCommand

**Files:**
- Modify: `apps/core/src/server.ts` (find the commands.resolve handler)

**Interfaces:**
- Consumes: `resolveCommand()` from registry.ts (now async)
- Produces: Updated IPC handler

**Note on projectPath:** The server doesn't have a "current session" in the commands.resolve handler context. However, other handlers in server.ts use `projectPath || process.cwd()` as a fallback. For commands, the semantics are:
- If user is in an active session, `cwd` is already the project root (session initializes with projectPath)
- If no session, `process.cwd()` is the working directory

So using `cwd` as both `cwd` and `projectPath` is actually correct for this use case.

- [ ] **Step 1: Find the commands.resolve handler in server.ts**

Run: `grep -n "commands.resolve" apps/core/src/server.ts`
Expected: Shows line 466

- [ ] **Step 2: Update the handler to be async**

Current code at line ~466-475:
```typescript
"commands.resolve": async (
  params: Record<string, unknown>,
): Promise<{ prompt: string }> => {
  const { name, args } = params as { name: string; args?: string[] };
  const prompt = resolveCommand(name, args ?? [], process.cwd());
  if (prompt == null) {
    throw new Error(`Command not found: ${name}`);
  }
  return { prompt };
},
```

Update to:
```typescript
"commands.resolve": async (
  params: Record<string, unknown>,
): Promise<{ prompt: string }> => {
  const { name, args } = params as { name: string; args?: string[] };
  const cwd = process.cwd();
  // Use cwd as projectPath - this is correct because:
  // 1. In an active session, cwd is set to projectPath at session start
  // 2. Without a session, process.cwd() is the working directory
  const prompt = await resolveCommand(name, args ?? [], cwd, cwd);
  if (prompt == null) {
    throw new Error(`Command not found: ${name}`);
  }
  return { prompt };
},
```

- [ ] **Step 3: Verify file compiles**

Run: `cd apps/core && npx tsc --noEmit src/server.ts`
Expected: No errors (may need minor adjustments)

- [ ] **Step 4: Commit**

```bash
git add apps/core/src/server.ts
git commit -m "feat(commands): update IPC handler for async resolveCommand"
```

---

### Task 5: Add test for user-defined commands loader

**Files:**
- Create: `apps/core/src/commands/loader.test.ts`

**Interfaces:**
- Tests: `loadCommands()`, `resolveUserCommand()`

- [ ] **Step 1: Write tests**

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { loadCommands, resolveUserCommand } from "./loader.js";

describe("commands/loader", () => {
  const testDir = path.join(os.tmpdir(), `freecode-commands-test-${Date.now()}`);

  beforeEach(() => {
    fs.mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it("loads command from project directory", async () => {
    // Create project/.freecode/commands/review/command.md
    const projectDir = path.join(testDir, "project");
    const commandsDir = path.join(projectDir, ".freecode", "commands", "review");
    fs.mkdirSync(commandsDir, { recursive: true });
    fs.writeFileSync(
      path.join(commandsDir, "command.md"),
      `---
name: review
description: Run code review
argHint: [files]
---
Review the following code:
{{args}}`
    );

    const commands = await loadCommands({ projectPath: projectDir });
    expect(commands).toHaveLength(1);
    expect(commands[0].name).toBe("review");
    expect(commands[0].description).toBe("Run code review");
    expect(commands[0].argHint).toBe("[files]");
  });

  it("resolves command with args placeholder", async () => {
    // Use correct project path (same as first test)
    const projectDir = path.join(testDir, "project");
    const commands = await loadCommands({ projectPath: projectDir });
    const reviewCmd = commands.find((c) => c.name === "review");
    expect(reviewCmd).toBeDefined();

    const prompt = resolveUserCommand(reviewCmd!, {
      cwd: "/test",
      args: ["src/main.ts", "src/utils.ts"],
    });
    expect(prompt).toContain("Review the following code:");
    expect(prompt).toContain("src/main.ts src/utils.ts");
  });

  it("returns empty array when commands directory doesn't exist", async () => {
    const commands = await loadCommands({ projectPath: "/nonexistent" });
    expect(commands).toHaveLength(0);
  });

  it("project commands take precedence over user commands", async () => {
    // Create project-scoped command
    const projectDir = path.join(testDir, "project");
    const projectCommandsDir = path.join(projectDir, ".freecode", "commands", "test");
    fs.mkdirSync(projectCommandsDir, { recursive: true });
    fs.writeFileSync(
      path.join(projectCommandsDir, "command.md"),
      `---
name: test
description: Project test command
---
This is the PROJECT test command.`
    );

    // Create user-scoped command (in home directory)
    const homeDir = path.join(testDir, "home");
    const userCommandsDir = path.join(homeDir, ".freecode", "commands", "test");
    fs.mkdirSync(userCommandsDir, { recursive: true });
    fs.writeFileSync(
      path.join(userCommandsDir, "command.md"),
      `---
name: test
description: User test command
---
This is the USER test command.`
    );

    const commands = await loadCommands({ projectPath: projectDir, homeDir });
    expect(commands).toHaveLength(2);

    // Project should come first (higher precedence)
    const testCmd = commands.find((c) => c.name === "test");
    expect(testCmd?.scope).toBe("project");
    expect(testCmd?.description).toBe("Project test command");
  });
});
```

- [ ] **Step 2: Run tests**

Run: `cd apps/core && pnpm test src/commands/loader.test.ts`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add apps/core/src/commands/loader.test.ts
git commit -m "test(commands): add loader tests"
```

---

### Task 6: Create example command files

**Files:**
- Create: `docs/examples/commands/review/command.md`
- Create: `docs/examples/commands/test/command.md`

- [ ] **Step 1: Create example review command**

```markdown
---
name: review
description: Run a code review on specific files
argHint: <files>
---
Review the following code changes or files for bugs, security issues, and code quality:

{{args}}

Provide a detailed report with:
1. Critical issues (must fix)
2. Suggestions for improvement
3. Positive observations
```

- [ ] **Step 2: Create example test command**

```markdown
---
name: test
description: Run tests with coverage
argHint: [pattern]
---
Run the test suite with coverage report.

{{#if args}}
Focus on: {{args}}
{{/if}}

Provide the coverage summary and any failing tests.
```

> **Note on `{{#if args}}`:** This is a placeholder for future Handlebars-style conditional logic. Currently it will be emitted as-is into the prompt. Remove these lines if you don't want literal text in the output.

- [ ] **Step 3: Commit**

```bash
git add docs/examples/commands/
git commit -m "docs(examples): add example user-defined commands"
```

---

## Summary

After completing all tasks:

1. ✅ Users can create `.freecode/commands/<name>/command.md` in their project
2. ✅ Users can create `~/.freecode/commands/<name>/command.md` globally
3. ✅ Commands support YAML frontmatter: name, description, argHint
4. ✅ Commands support template variables: {{args}}, {{cwd}}, {{arg1}}, {{arg2}}, etc.
5. ✅ Built-in commands (/init) still work unchanged
6. ✅ Project commands override user commands, which override built-in (precedence enforced)
7. ✅ Frontends get all commands via existing `commands.list` IPC method
8. ✅ No duplicate entries in command list (precedence-aware dedupe)

---

## Plan complete

**Saved to:** `docs/superpowers/plans/2026-07-31-user-defined-slash-commands.md`

**Two execution options:**

1. **Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

2. **Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
