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

5)The conversation isn't stored anywhere on the provider's side. There is no session. Anthropic's Messages API is fully stateless — your client reconstructs the entire conversation from scratch on every call, and the model re-reads all of it every time. "Memory" is an illusion your loop maintains by resending.

(Partial exceptions exist — OpenAI's Responses API can store state server-side via previous_response_id, Gemini has explicit cache objects — but your loop treats providers uniformly and resends, which is the right call for portability.)

6) Subagent UI


## Docs-audit findings (memory, sessions, knowledge graph — 2026-08-23)

Found while writing `apps/docs/app/internals/{memory,sessions,knowledge-graph}`.
Each is also listed in that page's **Known gaps** section. Sorted by kind: the
second group must NOT be "fixed" — they are deliberate and load-bearing.

### A. Real fixes

- [ ] **Dead code: `apps/core/src/session/normalize/`** — the ChatGPT/Claude/Gemini
      response normalizers (236 lines) have zero callers; normalization lives in
      `providers/streaming.ts`. Delete.
- [ ] **Stale `CLAUDE.md` row** — the subsystem table lists `session/service.ts`,
      which does not exist.
- [ ] **Thread store is written but never read** — `threadStore.create()`
      (`session/manager.ts:76`) is its only live call site. No turns, no tool calls;
      session listing reads `meta.json` instead. Two answers to "what sessions
      exist?" — either wire turns through `store/`, or delete it and keep the JSONL.
- [ ] **Memory project key collides** — `mem-store.ts:31` keys on
      `path.basename()`, so `~/work/api` and `~/side/api` share one memory store.
      Sessions already solved this with `store/path-formatter.ts` (full reversible
      path). Reuse it; needs a rename migration for existing `~/.freecode/projects/`.
- [ ] **No session-end signal** — `disposeSessionMemory` has one call site
      (`server.ts:967`, inside `session.delete`), so it never fires on switch, archive,
      stop, or exit. Six per-session caches hang off that one handler
      (`disposeSessionMemory`, `resetExtractPolicy`, `disposeOutputStore`,
      `disposeReadState`, `disposeCacheAwareness`, `disposeFrozenSessionContext`),
      so all six leak for any session that ends any other way. Blocks the memory
      end-of-session flush, the cheapest fix for "short session states a preference
      and loses it". **Do this first.**
- [ ] **`Contradicts` edges are never produced** — the kind, its zero weight, and
      the cascade skip are implemented and tested (`graph-types.ts:17`,
      `cascade.ts:59`), but nothing detects that two memories disagree. Contradiction
      handling is `supersedes:` only, which requires the writer to already know.
- [ ] **VectorStore rewrites everything on every write** — `put()`/`remove()` call
      `persist()`, re-serializing all vectors + both files (`vector-store.ts:181`).
      ~768 KB rewritten per save at 500 memories.
- [ ] **VectorStore lookups are linear scans** — `hasFresh`/`has`/`remove` `find()`
      over the array (`vector-store.ts:129`), and `syncVectors()` calls them per
      entry → O(n²) per full sync. Add an id→index `Map`.
- [ ] **Cluster ids are positional** — adding one memory can renumber every
      cluster (`clusters.ts:139`), so cluster identity doesn't survive a rebuild and
      anything the explorer persists about one is meaningless afterwards.
- [ ] **Embedder never retries** — one failure sets `broken = true` for the process
      lifetime (`embedder.ts:66`). Right for a missing native lib; wrong for a
      transient failure, which silently downgrades the rest of the run to keyword.
- [ ] **`nodeDetailForExplorer` is O(nodes + edges) per click** —
      rebuilds a node map and scans all edges per request (`graph/index.ts:394`).
- [ ] **Dangling wikilinks are invisible** — skipped correctly (`builder.ts:78`),
      but a typo'd `[[link]]` never surfaces anywhere. The explorer should list
      unresolved links.
- [ ] **Session delete is a status flag** — files stay on disk
      (`session/store.ts:337`). Recoverable by design, but a transcript holds file
      contents and command output; add `--purge` rather than changing the default.
- [ ] **7 of 16 rollout event types have no emitter** — `turn.aborted`,
      `subagent.start`, `subagent.stop`, `skill.invoked`, `hook.triggered`,
      `context.overflow`, `parse.error` are defined and recordable, but no live
      call site invokes their `record*` method. Replay is silent about sub-agents,
      skills, aborts and overflows. The loop already knows each of these moments —
      `context.overflow` at `loop.ts:1003`, subagent start/stop in `tools/agent.ts`,
      `hook.triggered` alongside the existing `recordHookBlocked` (`loop.ts:2069`).
- [ ] **Compaction summaries never see tool activity** — `MemoryService` records
      only user prompts and assistant text; a tool-calling turn is stored as the
      stub `[Executed N tools]` (`loop.ts:1567`). The transcript handed to the
      summarizer contains none of the edits, commands, or errors that were the
      actual work. **Biggest quality gap in compaction.**
- [ ] **Two heuristic-summarizer paths are consequently dead** —
      `extractToolCalls()` scans for `Tool <name>:` (`summarizer.ts:106`) and
      `normalizeContent()` truncates content starting with `"Tool "`
      (`service.ts:63`); no message ever has that shape, so the **Decisions**
      section is always `(none)` and `maxToolOutputChars` never applies.
- [ ] **Dead export: `renderPromptMemoryContext()`** (`selector.ts:64`) —
      referenced only by `loop.ts` comments explaining why it must not be used.
- [ ] **`getContextLimit(model)` ignores its argument** (`tokens.ts:20`) and
      returns the constant floor. Rename or drop the parameter.
- [ ] **Blocked-compaction retry threshold is hardcoded** — fixed 5,000 tokens
      (`service.ts:34`, flagged `ponytail` in-code); make it a `CompactionConfig`
      field if a hook ever needs tighter control.
- [ ] **`METHODS` declares 24 of 49 implemented IPC methods** — all of `memory.*`,
      `config.*`, `models.*`, and `session.{fork,switch,archive,delete,export,
      import,upload,download,getInterrupted}` exist in `server.ts` but not in
      `packages/shared/src/ipc/protocol.ts`. Frontends calling them get zero
      compile-time checking, which is the entire purpose of that map.
      (`CLAUDE.md` describes it as the source of truth — it isn't yet.)
- [ ] **`METHODS["session.send"]` is wrong** — declares
      `StreamResponse | { queued, id }` as the result; the handler resolves a
      `LoopResult` (`agent/types.ts:309`). Declared params also omit `model` and
      `agentMode`, both read by the handler (`server.ts:376`).
- [ ] **No `-32602` invalid-params validation** — every handler does
      `params as { … }` with no runtime check, so a missing or mistyped field
      becomes `undefined` deep inside and surfaces as a confusing `-32603`.
      A one-line guard per handler (or a shared validator keyed off `METHODS`)
      would move the failure to the boundary where it belongs.
- [ ] **TUI client can only stream one session at a time** — single
      `activeStreamId` + single `onStreamEvent` slot (`apps/tui/src/ipc/client.ts:46`),
      even though `bus/bridge.ts` stamps `sessionId` specifically to allow
      multiplexing. Blocks any multi-session UI over one core process.

        One thing I checked and didn't report as a bug: manual /compact builds its own MemoryService separate from the loop's. That would be a divergence risk,
  except a fresh loop (and service) is constructed per turn at server.ts:199 and reloads state from disk, so they stay consistent.

### B. Deliberate — do NOT "fix"

- **`MEMORY.md` is never injected.** Injecting it makes the cached system prefix
  depend on the store, so every save busts the session's prompt cache. Locked by a
  test in `mem-prompt.test.ts` (guidance block must be byte-identical).
- **`memory` is blocked in plan/review/explore.** Fail-closed was chosen knowingly;
  the cost is that a preference stated while planning isn't captured.
- **`MAX_SAVES_PER_RUN = 3` and the extraction gates.** The cap stands in for a
  consolidation pass that doesn't exist. Raise it only after consolidation ships.
- **Two logs — `messages.jsonl` mutable, `events.jsonl` append-only.** Looks like
  duplication; it is the reason compaction can trim history without destroying the
  record of what happened.
- **Cascade skips `Contradicts`; tag/cluster nodes relay but never score.**
- **Compaction fires on a cost target (120K), not on window fit.** Fit-only left a
  1M-window session re-sending 270K every turn — 48.1M input tokens in one
  7-message session. Raising `FREECODE_COMPACT_TARGET_TOKENS` reverts that.
- **Tool-result pruning freezes anything already sent whole.** It looks wasteful;
  it is what keeps the prompt-cache prefix byte-stable. Do not replace it with a
  sliding window.
- **`MAX_OVERFLOW_COMPACTIONS = 3`, and the retry is not re-wrapped.** A second
  overflow in one turn means compaction isn't converging; looping burns quota.
- **Stream events are bare `{type,…}` objects, not JSON-RPC notifications.** The
  envelope-free shape is intentional; changing it breaks all four clients at once.
  (Standardising on notifications is still worth considering — listed under fixes.)
- **`-32002` is a distinct code, not a generic internal error.** Two frontends
  answering one prompt is a race, not a failure; the loser renders "already
  answered" as state.
- **Web auth gates `/api` and `/events` but not the static SPA.** Gating the page
  would block the page that delivers the token.
- **k-means determinism (`SEED = 42`, id-sorted points).** Non-deterministic
  clustering means the same store retrieving different memories on different days.

### C. Roadmap (needs a spec first, not a fix)

- [ ] **Consolidation / episodic → semantic promotion.** `rollout/` has every past
      turn on disk; nothing mines it. Extraction only ever sees the live transcript,
      so a fact that only becomes clear on the fifth repetition is never learned.
- [ ] **Bi-temporal validity** — valid-time vs transaction-time, so "the host ran
      Apache until March" is expressible instead of only replaceable. Entries carry
      `createdAt`/`updatedAt` (transaction time) only.
- [ ] **Learned procedural memory** — skills and `.freecode/commands/` are real
      procedural memory, but hand-authored. Nothing distills a successful sequence
      into a reusable procedure with preconditions.
- [ ] **ANN index for vectors** — `cosineTopK` scans every vector
      (`vector-store.ts:199`). Exact and correct for hundreds; this is the ceiling.
- [ ] **Tuning values are guesses** — cap 3, interval 8, 200-char minimum, seed
      threshold 0.4, decay 0.7. Chosen to bound cost, not derived from data.
  and I'll fix it.