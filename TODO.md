# FreeCode Implementation TODOs

## Completed

- [x] Rollout/Event Sourcing system
- [x] Two-phase context collection
- [x] Phase 1 Skills infrastructure (manager, loader, registry, injection)
- [x] 10 Hook Types (8 fully wired, 2 stubbed)
- [x] Provider-specific prompts (session/prompt/\*.txt files)
- [x] Subagent Lifecycle (agent tool with hooks + Bus events)
- [x] Thread Store (SQLite + JSON persistence)
- [x] Permission Profiles (sandbox levels for tool permissions)

## Pending

### Extensibility gaps (audit 2026-07-31)

What a user can extend without editing FreeCode's source. Covered today: MCP servers,
skills (incl. `~/.claude/plugins` scope), permission rules via `.freecode/settings.json`,
and `CLAUDE.md`/`AGENTS.md` instructions. Ranked by value per line of work.

- [x] **1. Hooks from `settings.json`** — ✅ DONE. All 14 events are implemented and
      `hooks/executors/command.ts` can already shell out. Added `hooks/settings.ts` loader
      that reads `.freecode/settings.json` (project) and `~/.freecode/settings.json` (user),
      with project → user merge, fail-closed validation, file watching (300ms debounce),
      and automatic injection of `type: "command"`. Wired into `server.ts`. Spec:
      `docs/superpowers/specs/2026-07-31-hooks-settings-design.md`.

- [ ] **2. User-defined slash commands** — `apps/core/src/commands/registry.ts` is a
      hardcoded map with exactly one entry (`/init`). See the detailed section below;
      reuse the frontmatter-markdown discovery already in `skills/loader.ts`.

- [ ] **3. User-defined subagents** — `SubagentType` (`apps/core/src/agent/types.ts:38-43`)
      is a closed union of five, with descriptions in `SUBAGENT_DEFINITIONS`. No
      `.freecode/agents/*.md` loader. Bind loaded agents to the existing capability
      profiles in `permission/profiles.ts`. Shares its markdown loader with item 2.

- [ ] **4. Rules hierarchy** — `context/instructions.ts` reads `CLAUDE.md`/`AGENTS.md` from
      exactly two dirs (global `~/.freecode/`, project root), first match wins, 40k char cap.
      Missing: walk-up for monorepos, `@imports` (both deferred in the comment at line 6),
      and glob-scoped rules (the Cursor `.mdc` model — "apply only for `**/*.tsx`").
      Nested-directory rules would also give scoped skills somewhere to live.

- [ ] **5. Multimodal input** — `MessagePart` (`packages/shared/src/types.ts:12-19`) is
      text/code/tool only, and `read` cannot return an image. Blocks screenshots, design
      mocks, and diagram debugging. Touches the shared protocol + every provider adapter.

- [ ] **6. Background bash** — no `run_in_background` in `tools/bash.ts`, so a dev server
      or long build blocks the turn.

- [ ] **7. MCP server (expose)** — serve FreeCode's tools *as* an MCP server. The client
      side is done. Already listed as deferred in `CLAUDE.md`.

- [ ] **8. Checkpoints / rewind** — `rollout/` has full event sourcing and `replay.ts`, but
      there's no user-facing way to undo a turn's file changes. Mostly a command + a
      file-state diff on top of machinery we already paid for.

- [x] **9. TUI `@`-file mentions** — done. The audit was wrong: `CombinedAutocompleteProvider`
      was already wired in `apps/tui/src/index.ts`, but with `fdPath = null`, and pi-tui's
      `getFuzzyFileSuggestions` bails immediately without an fd binary — so `@` produced
      nothing while slash-command completion kept working. Fixed by resolving fd from PATH
      (`apps/tui/src/utils/fd-path.ts`) and passing it to both provider constructions.
      Matches pi's `interactive-mode.ts:651`. Still open follow-ups:
  - `@` is inert on machines without fd installed. pi downloads a copy
        (`coding-agent/src/utils/tools-manager.ts`); we could instead fall back to the
        readdir-based path completion pi-tui already has for non-`@` prefixes.
  - Nothing tells the model what `@path` means — like pi, we insert the path as plain
        text and rely on it calling `read`. A line in the system prompt would make that
        explicit. (Content expansion at send time, Claude Code style, is the other option;
        pi only does that for CLI `@file` args, in `cli/file-processor.ts`.)

**Suggested order:** 1 → 2 → 3 (2 and 3 share one markdown loader), then 4. Items 5 and 8
are larger, self-contained projects.




  - Stale entries in ## Completed — it says "10 Hook Types (8 fully wired, 2 stubbed)" (there are 14 now), and ### 
  Effect/Layer DI sits under Pending marked "Skipped", though apps/core/src/effect/ is implemented and documented as
  live in CLAUDE.md. Reads as contradictory next to a fresh audit.
  - Lines ~37–176 are a pasted terminal transcript (MCP subagent run output, "Input suggestion", progress spinners)
  sitting mid-file between the two Pending entries. Looks accidental. The only real content buried in it is the remote
  MCP server support note at the end (mcp/service.ts rejects non-local servers; config schema already has a url
  field) — that's a genuine TODO worth keeping.

  Want me to fix the stale statuses and strip the transcript, promoting the remote-MCP note to a proper entry?

### User-defined prompt commands loader

**Status:** Not started

Built-in prompt commands (e.g. `/init`) are defined in `apps/core/src/commands/registry.ts`
and exposed to every frontend via IPC (`commands.list` / `commands.resolve`). Extend the
registry to also load user/project-defined commands from `.freecode/commands/*.md` (front-matter
for `description`/`argHint`, body as the prompt template, `$ARGUMENTS` substitution).

**Reference:** opencode's `cfg.command` pattern in `packages/opencode/src/command/index.ts`.

- Loader reads `.freecode/commands/*.md` (project) and `~/.freecode/commands/*.md` (global)
- Parse front-matter → `PromptCommand`; merge into the registry alongside built-ins
- No frontend changes needed — they already fetch the merged list over IPC

### Effect/Layer DI (Complex - Skipped for now)

**Status:** Skipped - requires significant architectural change using Effect framework

**Reference:** opencode's `packages/opencode/src/effect/` directory for `makeRuntime<I, S, E>()` pattern

## Input suggestion

────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
❯ push  
────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

✶ Adding dependency to package.json… (1m 25s · ↓ 1.8k tokens · thought for 4s)
⎿ ◼ Task 1: Add dependency and configure package.json
◻ Task 2: Create MCP types and Zod schemas  
 ◻ Task 3: Create MCP config loader  
 ◻ Task 4: Create MCP transport implementation
◻ Task 5: Create MCP service with Effect/Layer  
 ◻ Task 6: Create CLI entry point with yargs  
 ◻ Task 7: Implement convertMcpTool function  
 ◻ Task 8: Integrate MCP tools into agent tool system  
 ◻ Task 9: Add Bus events for MCP  
 ◻ Task 10: End-to-end test with contextcarry MCP

       ⏵⏵ bypass permissions on (shift+tab to cycle) · esc to interrupt · ctrl+t to hide tasks                  ⧉ In pnpm-lock.yaml


       ● Read 1 file (ctrl+o to expand)


● Bash(Task 1: Add MCP dependency)  
 ⎿ Done (4 tool uses · 10.2k tokens · 33s)  
 (ctrl+o to expand)

● Task(Task 2: Create MCP types)  
 ⎿  
 Search(pattern: "apps/core/src/\*_/_.test.ts")

     +8 more tool uses (ctrl+o to expand)
     ctrl+b to run in background
                                                         ● Bash(Task 1: Add MCP dependency)

⎿ Done (4 tool uses · 10.2k tokens · 33s)
(ctrl+o to expand)

● Task(Task 2: Create MCP types)
⎿ Done (22 tool uses · 30.6k tokens · 4m 48s)
(ctrl+o to expand)  
 ⎿ Found 7 new diagnostic issues in 2 files (ctrl+o to expand)

● Task(Task 3: Create MCP config loader)  
 ⎿ Done (6 tool uses · 20.5k tokens · 1m 8s)  
 (ctrl+o to expand)

● Task(Task 4: Create MCP transport)  
 ⎿ Done (7 tool uses · 18.6k tokens · 32s)  
 (ctrl+o to expand)

● Task(Task 5: Create MCP service)  
 ⎿ Done (16 tool uses · 25.9k tokens · 2m 45s)  
 (ctrl+o to expand)

Task(Task 6: Create CLI entry point)  
 ⎿  
 Search(pattern: "export.\*getConfigDir|function getConfigDir|const getConfigDir", path: "apps/core/src")

     +9 more tool uses (ctrl+o to expand)
     ctrl+b to run in background


· Creating CLI entry point with yargs… (13m 28s · ↓ 17.6k tokens · thought for 16s)  
 ⎿ ◼ Task 6: Create CLI entry point with yargs  
 ◻ Task 7: Implement convertMcpTool function  
 ◻ Task 8: Integrate MCP tools into agent tool system  
 ◻ Task 9: Add Bus events for MCP  
 ◻ Task 10: End-to-end test with contextcarry MCP  
 ✔ Task 1: Add dependency and configure package.json  
 ✔ Task 2: Create MCP types and Zod schemas  
 ✔ Task 3: Create MCP config loader  
 ✔ Task 4: Create MCP transport implementation  
 ✔ Task 5: Create MCP service with Effect/Layer  
 Skill(superpowers:subagent-driven-development)
⎿ Successfully loaded skill

● I'm using Subagent-Driven Development to implement this plan.

Let me first read the plan and extract all tasks, then create the todo list and start dispatching implementer subagents.

● Read 1 file (ctrl+o to expand)

● Bash(Task 1: Add MCP dependency)
⎿ Done (4 tool uses · 10.2k tokens · 33s)
(ctrl+o to expand)

● Task(Task 2: Create MCP types)
⎿ Done (22 tool uses · 30.6k tokens · 4m 48s)
(ctrl+o to expand)  
 ⎿ Found 7 new diagnostic issues in 2 files (ctrl+o to expand)

● Task(Task 3: Create MCP config loader)  
 ⎿ Done (6 tool uses · 20.5k tokens · 1m 8s)  
 (ctrl+o to expand)

● Task(Task 4: Create MCP transport)  
 ⎿ Done (7 tool uses · 18.6k tokens · 32s)  
 (ctrl+o to expand)

● Task(Task 5: Create MCP service)  
 ⎿ Done (16 tool uses · 25.9k tokens · 2m 45s)  
 (ctrl+o to expand)

● Task(Task 6: Create CLI entry point)  
 ⎿ Done (37 tool uses · 47.6k tokens · 5m 44s)  
 (ctrl+o to expand)

● Task(Task 7: Implement convertMcpTool)  
 ⎿ Done (6 tool uses · 16.7k tokens · 43s)  
 (ctrl+o to expand)

● Task(Task 8: Integrate MCP tools)  
 ⎿ Done (9 tool uses · 28.7k tokens · 2m 24s)  
 (ctrl+o to expand)

● Task(Task 9: Add Bus events for MCP)  
 ⎿  
 Waiting… diff apps/core/src/bus/index.ts)

     +8 more tool uses (ctrl+o to expand)
     ctrl+b to run in background


✶ Adding Bus events for MCP… (24m 49s · ↓ 32.8k tokens · thought for 9s)  
 ⎿ ◼ Task 9: Add Bus events for MCP  
 ◻ Task 10: End-to-end test with contextcarry MCP  
 ✔ Task 1: Add dependency and configure package.json  
 ✔ Task 2: Create MCP types and Zod schemas  
 ✔ Task 3: Create MCP config loader  
 ✔ Task 4: Create MCP transport implementation  
 ✔ Task 5: Create MCP service with Effect/Layer  
 ✔ Task 6: Create CLI entry point with yargs  
 ✔ Task 7: Implement convertMcpTool function  
 ✔ Task 8: Integrate MCP tools into agent tool system

     ///////////////////////////

     ---

2. Remote MCP server support

This would enable:
freecode mcp add myserver remote "https://mcp.example.com/server"

Why it's not done: The current connect() function in mcp/service.ts (line 46-48) explicitly rejects remote servers:
if (server.type !== 'local') {
yield\* Effect.fail(new Error('Remote MCP servers not yet supported'));
return;
}

What's needed to implement it:

- Use SSEClientTransport or StreamableHTTPClientTransport from @modelcontextprotocol/sdk instead of
  StdioClientTransport
- Handle authentication (API keys, OAuth tokens)
- Handle connection lifecycle (reconnecting on failure)
- The init.ts connect logic would need a branch for local vs remote transport

The config schema already supports remote (url field in McpServerSchema), but the actual connection code only
handles local stdio.

Need a feature like this 
 ~128k uncached · /clear to start fresh
                                                                              new task? /clear to save 128.2k tokens

3) Unknown command: /apps/tui. Type /help for available commands


4)One real gotcha worth knowing, not just for this feature but for the whole memory system: it's basename only, not the full path. Two unrelated repos both named freecode on your machine (e.g. a fork checked out elsewhere) would collide into the same memory namespace. That's pre-existing behavior from before this session, not something the graph explorer introduced — flagging it since you asked how project identity works, not proposing to change it unless you want that looked at separately.