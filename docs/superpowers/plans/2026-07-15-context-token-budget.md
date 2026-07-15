# Context & Token-Budget Cleanup — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the unbounded surfaces in `apps/core`'s context assembly so the system prompt and exploration tools can't blow the token budget on a large or flat repo. Bring freecode in line with what claude-code, opencode, and jcode all converge on: a minimal orientation stub + tool-call-driven exploration, with numeric caps everywhere output can be unbounded.

**Why (the smell):** A comparative read of `/home/ayan-de/Projects/claude-code`, `/home/ayan-de/Projects/githubProjects/opencode`, and `/home/ayan-de/Projects/githubProjects/jcode` shows all three do the same thing: no file tree or file contents in the system prompt, only cwd/git/platform, with every exploration surface (`ls`, `glob`, `read`, `grep`-equivalent) numerically capped and a truncation message telling the model how to page further. freecode mostly does this too (`read.ts`, `bash.ts` already cap output) — but `glob.ts`/`grep.ts`/`tree-cache.ts` have no upper bound at all, unlike every peer's `ls`/`glob`. (`context/collector.ts`'s eager full-file-content reader is a separate, **dead** — never-imported — module; left untouched, see Notes.)

**CLAUDE.md correction (ignore, per user):** the "Two-Phase Context Collection" principle in this repo's `CLAUDE.md` (§ Key Design Decisions #2 — "LLM first returns which files it needs, then CLI reads those files") describes a flow that was never built and does not match any of the three reference implementations either. The actual live pattern (`tree-cache.ts` + tool-call exploration) is closer to what claude-code/opencode/jcode do. This plan does **not** implement the literal two-phase flow; Task 5 rewrites that CLAUDE.md section to describe what's actually there.

**Tech Stack:** TypeScript ESM (`.js` import suffix), Node stdlib + existing deps (`fast-glob`). Tests: `node:test` + `node:assert/strict`, colocated `*.test.ts`, run via `pnpm tsx --test <file>` from `apps/core/`.

## Global Constraints

- No new npm dependencies.
- Local imports use the `.js` suffix (ESM).
- New/modified files stay under ~150 lines (CLAUDE.md convention) — split if a task pushes a file over.
- Do not change any tool's wire-visible schema (`parameters`) unless a task says so explicitly — caps are enforced in `execute()`, not by adding required params.
- Core test commands run from `apps/core/`. Commit after each task (`refactor(core): ...` / `feat(core): ...` / `docs: ...`); skip commits if the user mandates.

## Background (current state — verified)

- **Dead eager-context path (out of scope, left alone):** `context/collector.ts` (`collectContext()`) + `context/strategies/file-tree.ts` (`FileTreeStrategy`, recursively reads **every file's full contents** up to `maxDepth=3` into a `files: Record<string,string>` map) + `context/strategies/index.ts` (registry). Verified via `grep -rn "context/collector|context/strategies|FileTreeStrategy" apps/` — **zero imports anywhere outside these three files.** The loop's own `collectContext()` (`agent/loop.ts:1007`) is an unrelated private method that calls `getProjectContext()` from `tree-cache.ts`, not this module. It costs nothing at runtime since it's never called — see Notes for why this plan doesn't delete it.
- **Live tree path, uncapped:** `context/tree-cache.ts:30-35` (`computeProjectContext`) lists the project root's **top-level directory entries only** (no recursion, good) via `fs.readdirSync`, but with **no cap** on entry count — a flat root with hundreds of files dumps them all into the cached tree, which flows into `compiler.ts:compileProjectSummary` and then the cached system-prompt block.
- **`tools/glob.ts:97-117`:** `fg.async(...)` result count has **no cap** — every matching path is joined into the tool result unconditionally. Peers cap this (opencode: 100 matches; jcode `ls`: `MAX_ENTRIES=100`).
- **`tools/grep.ts:165-166`:** `head_limit` is optional and only applied when the model explicitly supplies it — no default `--max-count`, so an unbounded pattern on a big repo returns unbounded matches.
- **Already fine, no change needed:** `tools/read.ts` (`MAX_LINE_LENGTH=2000`, `MAX_BYTES=50KB`, `DEFAULT_LIMIT=2000` lines, pagination hint), `tools/bash.ts` (`MAX_OUTPUT_BYTES=500_000`, truncation with `[output truncated]` marker), `context/instructions.ts` (global + project-root only, no ancestor walk-up, `MAX_INSTRUCTIONS_CHARS=40_000` — already matches jcode's simplest-of-the-three style).
- **No token/char accounting anywhere in `compiler.ts`** — `compileSystemBlocks` returns two opaque `SystemBlock` strings with no visibility into what each section costs.

## Comparative reference (verified by prior investigation)

| | claude-code | opencode | jcode | freecode (this plan) |
| --- | --- | --- | --- | --- |
| System prompt file context | cwd/git-bool/platform only | cwd/worktree/git/platform only | cwd/git-branch/±5 changed filenames | shallow 1-level dir listing + git head (kept, now capped) |
| File tree/contents | none — tool calls only | none — tool calls only | none — dedicated `ls` tool | none live — dead eager-reader untouched, unused |
| Explicit caps | git status capped 2000 chars | tool output capped 50KB/2000 lines, spilled to disk | `ls` capped 100 entries, `read` capped 5000 lines | tree capped (Task 1), glob capped (Task 2), grep capped (Task 3) |
| Token accounting | none explicit | none explicit | `ContextInfo` struct, `chars/4` estimate | lightweight char ledger (Task 4), no compaction (deferred) |
| AGENTS.md/CLAUDE.md | walk every ancestor, 40k cap | walk up, first match only | two fixed locations, no walk-up | two fixed locations, 40k cap — **already matches jcode, no change** |

## File Structure

| File | Status | Responsibility |
| --- | --- | --- |
| `apps/core/src/context/tree-cache.ts` | Modify | Cap top-level entry count with truncation marker |
| `apps/core/src/context/tree-cache.test.ts` | Modify | Cover the new cap |
| `apps/core/src/tools/glob.ts` | Modify | Cap result count with truncation marker |
| `apps/core/src/tools/glob.test.ts` | Create | Cover the new cap |
| `apps/core/src/tools/grep.ts` | Modify | Default `head_limit` when caller omits it |
| `apps/core/src/tools/grep.test.ts` | Create | Cover the default cap |
| `apps/core/src/context/compiler.ts` | Modify | Add `compileContextLedger()` — per-section char counts + `chars/4` estimate |
| `apps/core/src/context/compiler.test.ts` | Modify | Cover the ledger |
| `/home/ayan-de/Projects/freecode/CLAUDE.md` | Modify | Rewrite "Two-Phase Context Collection" to describe the real lazy/capped flow |

---

### Task 1: Cap the project-tree listing

**Files:** Modify `context/tree-cache.ts`; modify `context/tree-cache.test.ts`.

**Interfaces:** `computeProjectContext` truncates the top-level listing past `MAX_ENTRIES`; `ProjectContext.tree` gains a trailing `... truncated at N entries` line when capped. No signature change.

- [ ] **Step 1: Failing test** — add to `tree-cache.test.ts`:
  ```ts
  test("caps the tree listing at MAX_ENTRIES with a truncation marker", () => {
    const dir = mkdtempSync(join(tmpdir(), "freecode-tree-cap-"));
    for (let i = 0; i < 150; i++) writeFileSync(join(dir, `f${i}.txt`), "x");
    const ctx = getProjectContext(dir);
    const lines = ctx.tree.split("\n").filter((l) => l.length > 0);
    assert.ok(lines.length <= 101, "capped list plus one marker line");
    assert.match(ctx.tree, /truncated/);
  });
  ```
  Run: `pnpm tsx --test src/context/tree-cache.test.ts` → FAIL.
- [ ] **Step 2: Implement** — in `tree-cache.ts`, add `const MAX_ENTRIES = 100;` and in `computeProjectContext`, slice `entries` to `MAX_ENTRIES` before mapping, appending `\n... truncated at ${MAX_ENTRIES} entries (${entries.length} total)` when `entries.length > MAX_ENTRIES`.
- [ ] **Step 3: Pass** — same command → PASS.
- [ ] **Step 4: Commit** *(skip if mandated)* — `refactor(core): cap project-tree listing at 100 entries`

---

### Task 2: Cap glob results

**Files:** Modify `tools/glob.ts`; create `tools/glob.test.ts`.

**Interfaces:** `executeGlob` truncates `entries` to `MAX_RESULTS` before formatting; `metadata.count` reports the **total** match count (not the truncated display count) so the model knows to narrow its pattern; output gains a truncation line when capped.

- [ ] **Step 1: Failing test** — create `tools/glob.test.ts`:
  ```ts
  import test from "node:test";
  import assert from "node:assert/strict";
  import { mkdtempSync, writeFileSync } from "fs";
  import { tmpdir } from "os";
  import { join } from "path";
  import { GlobTool } from "./glob.js";

  test("caps results and reports the true total in metadata", async () => {
    const dir = mkdtempSync(join(tmpdir(), "freecode-glob-cap-"));
    for (let i = 0; i < 150; i++) writeFileSync(join(dir, `f${i}.ts`), "");
    const res = await GlobTool.execute(
      { pattern: "*.ts", cwd: dir },
      { cwd: dir } as any,
    );
    assert.ok(res.success);
    const lines = res.result!.output.split("\n");
    assert.ok(lines.length <= 101);
    assert.equal(res.result!.metadata?.count, 150);
    assert.match(res.result!.output, /truncated/);
  });
  ```
  Run: `pnpm tsx --test src/tools/glob.test.ts` → FAIL.
- [ ] **Step 2: Implement** — in `glob.ts`, add `const MAX_RESULTS = 100;` after the existing constants. In `executeGlob`, keep `metadata: { count: entries.length }` (true total) but build `formatted` from `entries.slice(0, MAX_RESULTS)`, appending `\n... truncated at ${MAX_RESULTS} matches (${entries.length} total, narrow the pattern)` when `entries.length > MAX_RESULTS`.
- [ ] **Step 3: Pass** — same command → PASS.
- [ ] **Step 4: Commit** *(skip if mandated)* — `refactor(core): cap glob tool results at 100 matches`

---

### Task 3: Default-cap grep matches

**Files:** Modify `tools/grep.ts`; create `tools/grep.test.ts`.

**Interfaces:** `head_limit` defaults to `DEFAULT_HEAD_LIMIT` when the caller omits it (the model can still override with a larger explicit value — do not clamp an explicit `head_limit`, only supply the default).

- [ ] **Step 1: Failing test** — create `tools/grep.test.ts` mirroring the existing grep tool's execute signature (read `tools/grep.ts` execute/params shape first to match exactly — do not guess field names). Assert that calling without `head_limit` on a fixture directory with >100 matching lines produces a capped result, and that passing an explicit `head_limit: 500` is respected as-is (not overridden by the default).
- [ ] **Step 2: Implement** — in `grep.ts`, add `const DEFAULT_HEAD_LIMIT = 100;`. Change the `--max-count` branch (currently `if (params.head_limit)`) to always push `--max-count=${params.head_limit ?? DEFAULT_HEAD_LIMIT}`.
- [ ] **Step 3: Pass** — `pnpm tsx --test src/tools/grep.test.ts` → PASS.
- [ ] **Step 4: Commit** *(skip if mandated)* — `refactor(core): default grep head_limit to 100 matches`

---

### Task 4: Lightweight context ledger (visibility, not compaction)

**Files:** Modify `context/compiler.ts`; modify `context/compiler.test.ts`.

**Interfaces:** New `PromptCompiler.compileContextLedger(blocks: SystemBlock[]): { section: string; chars: number; estimatedTokens: number }[]` — pure function over the already-built `SystemBlock[]` (no new data collection, no new caching). `estimatedTokens = Math.ceil(chars / 4)`, matching jcode's `chars/4` heuristic. Not wired into any runtime call site by this task — it's a diagnostic entry point for a future `/context`-style command or log line, deliberately not auto-invoked (YAGNI: no consumer needed yet to be useful for debugging via a manual call).

- [ ] **Step 1: Failing test** — add to `compiler.test.ts`:
  ```ts
  test("compileContextLedger reports char/token estimates per block", () => {
    const compiler = new PromptCompiler("/tmp/proj", "proj");
    const blocks = [
      { text: "a".repeat(400), cache: true },
      { text: "b".repeat(40), cache: false },
    ];
    const ledger = compiler.compileContextLedger(blocks);
    assert.equal(ledger.length, 2);
    assert.equal(ledger[0].chars, 400);
    assert.equal(ledger[0].estimatedTokens, 100);
    assert.equal(ledger[1].section, "dynamic");
  });
  ```
  Run: `pnpm tsx --test src/context/compiler.test.ts` → FAIL.
- [ ] **Step 2: Implement** — in `compiler.ts`, add `compileContextLedger` as an instance method: map each block to `{ section: block.cache ? "static" : "dynamic", chars: block.text.length, estimatedTokens: Math.ceil(block.text.length / 4) }`.
- [ ] **Step 3: Pass** — `pnpm tsx --test src/context/compiler.test.ts` → PASS.
- [ ] **Step 4: Commit** *(skip if mandated)* — `feat(core): add context ledger for prompt token visibility`

---

### Task 5 (docs-only): Correct CLAUDE.md's Two-Phase Context Collection claim

**Files:** Modify `/home/ayan-de/Projects/freecode/CLAUDE.md`.

- [ ] **Step 1:** Locate `### 2. Two-Phase Context Collection` under `## Key Design Decisions`. Replace its description with what's actually implemented after Task 1–4: a capped, one-level directory listing + git head is cached (`context/tree-cache.ts`, event-invalidated on mutating tools) and injected into the static/dynamic system-prompt split (`context/compiler.ts`); no eager file-content reading happens anywhere — the model reads files itself via the `read`/`glob`/`grep` tools, each capped (`read.ts`, `glob.ts`, `grep.ts`, `bash.ts`). Keep the section numbered/titled the same so cross-references don't break; only the body changes.
- [ ] **Step 2: Commit** *(skip if mandated)* — `docs: correct two-phase context collection description to match implementation`

---

## Manual verification (after all tasks)

1. `pnpm --filter @thisisayande/freecode-core exec tsc --noEmit` — clean build.
2. `cd apps/core && pnpm test` — expect green except the pre-existing unrelated failures already known from the last plan (`mcp/convert-tool.test.ts`, `session/manager.test.ts`, `session/store.test.ts` missing `vitest`; `memory/summarizer.test.ts` drift).
3. In a scratch dir with 200+ top-level files, start the TUI, send a prompt that triggers a broad `glob "**/*"` and a `grep` with no `head_limit` — confirm both tool outputs show the truncation marker and stay well under a few KB, and the system prompt's tree section is capped too (spot-check via a manual `compileContextLedger` call in a REPL/test, since it isn't wired to a live UI yet).

## Notes / deferred (do NOT implement unless stated)

- **`context/collector.ts` + `context/strategies/` (dead eager file-content reader) — intentionally left in place.** Verified zero imports anywhere; it costs nothing at runtime. Per project convention (don't remove pre-existing dead code unless asked) and user confirmation, this plan does not touch it. If it's ever a source of confusion (e.g. someone wires it up not realizing the cost), delete it then — not preemptively here.
- **jcode's EWMA-based proactive compaction** (projecting token growth over a lookahead window and firing compaction before overflow) is a meaningfully bigger system than this plan's scope — `compileContextLedger` (Task 5) gives the *measurement* primitive a future compaction plan would consume; do not build the compaction trigger itself here.
- **opencode's spill-to-disk-on-overflow** (writing truncated tool output to a temp file the model can grep/read-with-offset) is a nice ergonomic upgrade over freecode's current "just truncate and say so" but is a separate, generic `tools/` cross-cutting change (would touch `read.ts`, `bash.ts`, `glob.ts`, `grep.ts` uniformly) — out of scope; the truncation markers added here (Tasks 2–4) are the minimal fix for the actual token-cost problem.
- **AGENTS.md ancestor walk-up** (claude-code's every-ancestor-directory walk) is explicitly **not** being added — `instructions.ts`'s current two-fixed-locations approach already matches jcode's simplest-of-three pattern and there's no evidence freecode's monorepo users need per-subdirectory instruction files yet (YAGNI).
- **Wiring `compileContextLedger` into a live `/context`-style command or log line** is deferred — this plan only adds the measurement function; a consumer (TUI command, debug log) is a separate, smaller follow-up once it's clear what output format is useful.
