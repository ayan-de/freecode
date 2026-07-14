# Project Instructions (CLAUDE.md / AGENTS.md) + Provider Prompt Wiring — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Status (2026-07-14): EXECUTED** — all 3 tasks implemented via subagent-driven development, per-task reviews + final whole-branch review passed, 10/10 tests passing. Commit steps skipped by user mandate; changes are uncommitted in the working tree. Two fixes applied beyond the plan text: (1) `compiler.test.ts` isolates `HOME` so tests never read the real `~/.freecode` (fixes a plan-internal contradiction with Task 1's interface note); (2) `session/prompt.ts` `PROMPT_FILES` reordered — `chatgpt` above `gpt` — because the `chatgpt.txt` entry was unreachable (pre-existing bug activated by Task 3's `model ?? provider` fallback), pinned by a 4th compiler test. Manual verification (section below) not yet run.

**Goal:** The agent loop's system prompt gains (a) user-authored project instructions from `CLAUDE.md`/`AGENTS.md` and (b) the curated provider prompts in `session/prompt/*.txt`, which are currently dead code.

**Architecture:** One new pure function (`compileInstructionsSection`) reads instruction files from the global config dir (`~/.freecode/`) and the project root — per location, `CLAUDE.md` wins over `AGENTS.md`, first match only. `PromptCompiler.compileSystemBlocks` (the only prompt path the agent loop uses) injects that section plus the existing-but-never-called `loadProviderPrompt` into the static (`cache: true`) system block. No walk-up hierarchy, no `@import` syntax, no `.claude/rules/` — those are explicitly deferred (see Notes).

**Tech Stack:** TypeScript ESM (imports use `.js` suffix), Node `fs`/`os`/`path` only — no new dependencies. Tests: `node:test` + `node:assert/strict`, colocated as `*.test.ts`, run via `tsx --test`.

## Global Constraints

- No new npm dependencies.
- All imports of local files use the `.js` suffix (ESM, matches existing code).
- New files stay under ~150 lines (project convention from CLAUDE.md).
- Tests use `node:test` + `assert` from `node:assert/strict`, colocated next to source (`src/context/instructions.test.ts` pattern), matching `src/tools/batching.test.ts`.
- All test commands run from `apps/core/`: `pnpm tsx --test <file>` for one file, `pnpm test` for the whole suite.
- Do not modify `PromptCompiler.compile()` — it has no non-test callers (legacy); only `compileSystemBlocks` feeds the agent loop.
- Commit after each task, message style: `feat(core): ...` / `fix(core): ...`.

## Background (why this exists)

- `apps/core/src/context/compiler.ts` builds the entire system prompt. Today it contains only: a 4-line mode prompt, formatting guidelines, a tool-name list, the file tree, and session memory. **No user instruction files are ever read.** Competing agents (claude-code, opencode, jcode) all inject `CLAUDE.md`/`AGENTS.md`.
- `apps/core/src/agent/loop.ts:49` imports `loadProviderPrompt` from `../session/prompt.js` but **never calls it** — the six curated prompts in `apps/core/src/session/prompt/*.txt` (anthropic.txt, default.txt, ...) are dead code. This plan wires them in and removes the dead import.
- Reference implementations studied: jcode `crates/jcode-base/src/prompt.rs:815` (minimal, ~40 lines — the model for this plan), opencode `packages/opencode/src/session/instruction.ts` (walk-up + just-in-time nested injection — deferred), claude-code `utils/claudemd.ts` (4-tier + @imports + conditional rules — deferred).

## File Structure

| File | Status | Responsibility |
| --- | --- | --- |
| `apps/core/src/context/instructions.ts` | Create | Read instruction files, render the "Instructions from: ..." section (pure function, ~45 lines) |
| `apps/core/src/context/instructions.test.ts` | Create | Loader behavior: precedence, ordering, empty, truncation |
| `apps/core/src/context/compiler.ts` | Modify | Inject instructions section + provider prompt into the static system block |
| `apps/core/src/context/compiler.test.ts` | Create | System-block assembly: instructions present, provider prompt present |
| `apps/core/src/agent/loop.ts` | Modify | Remove dead `loadProviderPrompt` import (line 49) |

---

### Task 1: Instructions loader (`context/instructions.ts`)

**Files:**
- Create: `apps/core/src/context/instructions.ts`
- Test: `apps/core/src/context/instructions.test.ts`

**Interfaces:**
- Consumes: nothing from this codebase (Node stdlib only).
- Produces: `compileInstructionsSection(projectPath: string, globalDir?: string): string` — returns the rendered section (possibly `""`). `globalDir` defaults to `path.join(os.homedir(), ".freecode")`; the parameter exists so tests never touch the real home directory. Task 2 calls this with one argument.

- [x] **Step 1: Write the failing tests**

Create `apps/core/src/context/instructions.test.ts`:

```ts
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
```

- [x] **Step 2: Run tests to verify they fail**

Run (from `apps/core/`): `pnpm tsx --test src/context/instructions.test.ts`
Expected: FAIL — `Cannot find module './instructions.js'`

- [x] **Step 3: Write the implementation**

Create `apps/core/src/context/instructions.ts`:

```ts
// =============================================================================
// Project Instructions Loader
// Reads user-authored instruction files into the system prompt.
// Per location, CLAUDE.md wins over AGENTS.md (first non-empty match only).
// Locations, in prompt order: global (~/.freecode/), then project root.
// ponytail: root-level files only; walk-up hierarchy / @imports deferred
// until monorepo users ask (see plan doc Notes).
// =============================================================================

import * as fs from "fs";
import * as os from "os";
import * as path from "path";

const INSTRUCTION_FILES = ["CLAUDE.md", "AGENTS.md"];
const MAX_INSTRUCTIONS_CHARS = 40_000;

function readFirstMatch(
  dir: string,
): { path: string; content: string } | undefined {
  for (const name of INSTRUCTION_FILES) {
    const filePath = path.join(dir, name);
    try {
      const content = fs.readFileSync(filePath, "utf-8").trim();
      if (content) return { path: filePath, content };
    } catch {
      // missing/unreadable — try the next candidate
    }
  }
  return undefined;
}

/**
 * Render the project-instructions section for the system prompt.
 * Returns "" when no instruction files exist.
 */
export function compileInstructionsSection(
  projectPath: string,
  globalDir: string = path.join(os.homedir(), ".freecode"),
): string {
  const found = [readFirstMatch(globalDir), readFirstMatch(projectPath)].filter(
    (f): f is { path: string; content: string } => f !== undefined,
  );
  if (found.length === 0) return "";

  let section = found
    .map((f) => `Instructions from: ${f.path}\n${f.content}`)
    .join("\n\n");
  if (section.length > MAX_INSTRUCTIONS_CHARS) {
    section =
      section.slice(0, MAX_INSTRUCTIONS_CHARS) +
      `\n[Instructions truncated at ${MAX_INSTRUCTIONS_CHARS} characters]`;
  }
  return section;
}
```

- [x] **Step 4: Run tests to verify they pass**

Run (from `apps/core/`): `pnpm tsx --test src/context/instructions.test.ts`
Expected: PASS — 6 tests, 0 failures

- [ ] **Step 5: Commit** *(skipped — user mandate: no commits; work left in working tree)*

```bash
git add apps/core/src/context/instructions.ts apps/core/src/context/instructions.test.ts
git commit -m "feat(core): add CLAUDE.md/AGENTS.md project instructions loader"
```

---

### Task 2: Inject instructions into the system prompt

**Files:**
- Modify: `apps/core/src/context/compiler.ts` (imports + `compileSystemBlocks`, currently lines 222-256)
- Test: `apps/core/src/context/compiler.test.ts` (create)

**Interfaces:**
- Consumes: `compileInstructionsSection(projectPath: string): string` from Task 1 (single-argument call — global dir defaults to `~/.freecode`).
- Produces: no signature changes. `compileSystemBlocks(...)` keeps its exact current signature; the returned `blocks[0]` (static, `cache: true`) now additionally contains the instructions section between the mode prompt and the tools section.

- [x] **Step 1: Write the failing test**

Create `apps/core/src/context/compiler.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { PromptCompiler } from "./compiler.js";

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
    [],
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
    [],
    "src/",
    "abc123",
    "",
    "mock-provider-b",
  );
  assert.equal(blocks.length, 2);
  assert.ok(!blocks[0].text.includes("Instructions from:"));
});
```

(Distinct provider names per test avoid the module-level `toolSchemaCache` leaking between tests.)

- [x] **Step 2: Run test to verify it fails**

Run (from `apps/core/`): `pnpm tsx --test src/context/compiler.test.ts`
Expected: FAIL — first test's `includes("ALWAYS-USE-SPACES-MARKER")` assertion fails (second test may already pass)

- [x] **Step 3: Modify `compileSystemBlocks`**

In `apps/core/src/context/compiler.ts`, add the import at the top (after the existing imports, around line 9):

```ts
import { compileInstructionsSection } from "./instructions.js";
```

Then in `compileSystemBlocks`, replace the `staticText` assembly:

```ts
    const staticText = [
      this.compileSystemPrompt(),
      "",
      this.compileToolsSection(tools, provider, model),
    ]
      .filter((s) => s.length > 0)
      .join("\n\n");
```

with:

```ts
    const staticText = [
      this.compileSystemPrompt(),
      compileInstructionsSection(this.projectPath),
      this.compileToolsSection(tools, provider, model),
    ]
      .filter((s) => s.length > 0)
      .join("\n\n");
```

(The instructions land in the `cache: true` block deliberately: they change rarely, so provider-side prompt caching still hits; an edit mid-session busts the cache once, which is correct. The two `readFileSync` calls per turn are negligible.)

- [x] **Step 4: Run tests to verify they pass**

Run (from `apps/core/`): `pnpm tsx --test src/context/compiler.test.ts`
Expected: PASS — 2 tests, 0 failures

- [x] **Step 5: Run the full core suite to check for regressions**

Run (from `apps/core/`): `pnpm test`
Expected: PASS — no failures (loop-caching / loop-memory / loop-session-store tests unaffected)

- [ ] **Step 6: Commit** *(skipped — user mandate: no commits; work left in working tree)*

```bash
git add apps/core/src/context/compiler.ts apps/core/src/context/compiler.test.ts
git commit -m "feat(core): inject CLAUDE.md/AGENTS.md instructions into system prompt"
```

---

### Task 3: Wire the dead provider prompts into the compiler

**Files:**
- Modify: `apps/core/src/context/compiler.ts` (same `staticText` block as Task 2)
- Modify: `apps/core/src/agent/loop.ts:49` (delete dead import)
- Test: `apps/core/src/context/compiler.test.ts` (extend)

**Interfaces:**
- Consumes: `loadProviderPrompt(modelId: string): string` from `apps/core/src/session/prompt.ts` (already exists; selects `session/prompt/*.txt` by substring match on the model id, falls back to `default.txt`).
- Produces: `blocks[0].text` now starts with the provider prompt (e.g. `# FreeCode Agent ...` from `anthropic.txt` for Claude models). No signature changes.

- [x] **Step 1: Write the failing test**

Append to `apps/core/src/context/compiler.test.ts`:

```ts
import { loadProviderPrompt } from "../session/prompt.js";

test("compileSystemBlocks starts the static block with the provider prompt", () => {
  const project = tmpDir();
  const compiler = new PromptCompiler(project, "test-project", "build");
  const blocks = compiler.compileSystemBlocks(
    [],
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
```

(Note: `import` lines must sit at the top of the file with the other imports, not mid-file — shown here inline for clarity about what's new.)

- [x] **Step 2: Run test to verify it fails**

Run (from `apps/core/`): `pnpm tsx --test src/context/compiler.test.ts`
Expected: FAIL — `startsWith` assertion fails (static block currently starts with the mode prompt)

- [x] **Step 3: Modify the compiler**

In `apps/core/src/context/compiler.ts`, add the import:

```ts
import { loadProviderPrompt } from "../session/prompt.js";
```

Replace the Task 2 `staticText` assembly:

```ts
    const staticText = [
      this.compileSystemPrompt(),
      compileInstructionsSection(this.projectPath),
      this.compileToolsSection(tools, provider, model),
    ]
      .filter((s) => s.length > 0)
      .join("\n\n");
```

with:

```ts
    const staticText = [
      loadProviderPrompt(model ?? provider).trim(),
      this.compileSystemPrompt(),
      compileInstructionsSection(this.projectPath),
      this.compileToolsSection(tools, provider, model),
    ]
      .filter((s) => s.length > 0)
      .join("\n\n");
```

Prompt order is deliberate: identity/tool guidance (provider prompt) → mode constraints (mode prompt) → user instructions (highest-specificity, closest to the task) → tool list.

- [x] **Step 4: Remove the dead import from the agent loop**

In `apps/core/src/agent/loop.ts`, delete line 49:

```ts
import { loadProviderPrompt } from "../session/prompt.js";
```

(It was imported but never called; the call site now lives in the compiler.)

- [x] **Step 5: Run the full core suite**

Run (from `apps/core/`): `pnpm test`
Expected: PASS — all tests including the 3 compiler tests and 6 instructions tests

- [ ] **Step 6: Commit** *(skipped — user mandate: no commits; work left in working tree)*

```bash
git add apps/core/src/context/compiler.ts apps/core/src/agent/loop.ts apps/core/src/context/compiler.test.ts
git commit -m "feat(core): wire provider prompts into system prompt, drop dead loop import"
```

---

## Manual verification (after all tasks)

1. From the repo root, build core and start a TUI session in a project that has a `CLAUDE.md`.
2. Ask the agent: *"What project instructions were you given?"* — it should quote content from that `CLAUDE.md`.
3. Confirm it also self-identifies per the provider prompt ("FreeCode") instead of the bare mode prompt.

## Notes / deferred (do NOT implement now)

- **Walk-up hierarchy** (collect instruction files from ancestor directories, opencode `findUp` style) — deferred until monorepo usage demands it.
- **Just-in-time nested injection** (attach a subdirectory's CLAUDE.md when the agent reads files under it — opencode `instruction.ts` `resolve()`, claude-code `getMemoryFilesForNestedDirectory`) — deferred; highest-value phase 2.
- **`@import` syntax, `.claude/rules/*.md`, conditional path-matched rules, `CLAUDE.local.md`, enterprise/managed tier** (claude-code `utils/claudemd.ts`) — deferred indefinitely.
- **Known overlap:** `session/prompt/*.txt` files contain their own "Response Formatting" section that partially duplicates `compileSystemPrompt`'s formatting guidelines. Harmless; consolidating the `.txt` files is a separate cleanup, out of scope here.
- **`PromptCompiler.compile()`** (the non-block legacy path) intentionally does not get instructions — it has no production callers.
