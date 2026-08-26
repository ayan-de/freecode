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
- [x] **Keyword fallback overrides a confident vector miss** — `seed()`
      (`graph/index.ts:253`) falls back to `findRelevantMemories()` whenever
      `cosineTopK(10, 0.4)` returns nothing, and `retrieve()` does it again
      (`out.length > 0 ? out : fallback()`). The keyword floor is `score > 0`, and
      `score()` awards +1 for any 3-char *substring* overlap (`add`↔`address`), so
      "what's 2+2" against a populated store injects up to 8 irrelevant memories.
      **The fix is not "gate the fallback off"** — see the prior-art section
      below; it is BM25 + rank fusion with the floor applied after fusion.
      Spec: `specs/2026-08-23-memory-consolidation.md` D1 (revised 2026-08-23).
- [x] **The injected memory block has no byte ceiling** —
      `renderRetrievedMemories()` (`mem-prompt.ts:128`) emits full bodies for up to
      8 entries with `cache: false` (`loop.ts:1325`). A count cap can't see "one
      memory with a 4 KB body"; claude-code caps its entrypoint at
      `MAX_ENTRYPOINT_BYTES = 25_000` for exactly this. Add a byte budget with
      degradation to `name — description`. Spec: same doc, D2.
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
## Docs-audit findings (reference: CLI, settings, env, IPC, hooks — 2026-08-23)

Found while writing `apps/docs/app/reference/{cli,settings,env,ipc-methods,hook-events}`.
Each is also listed in that page's **Known gaps**. IPC items already covered by the
earlier audit are not repeated here.

### Real fixes

- [ ] **`freecode run` runs without hooks.** `HookSettingsManager` is constructed
      only in `startServer()` (`server.ts:1106`), so a headless run loads no
      `settings.json` hooks and never calls `registerRtkHook()`. Permission *rules*
      do apply (the loop builds its own `PermissionSettingsManager`,
      `loop.ts:571`), so the same repo behaves differently under `serve` and under
      `run` — the formatter that fires after every edit interactively silently does
      not fire in CI. Move both into a shared bootstrap the `run` handler also calls.
- [ ] **Headless `build` mode denies everything and says nothing useful.**
      `askPermission` rejects immediately when no frontend is listening
      (`bus/index.ts:413`) and `promptForPermission` maps that to deny, while
      `build`'s mode default for mutating tools is `ask`. So `freecode run "fix the
      test"` reads fine and is denied every write. Needs a `--yes`/`--allow <rule>`
      flag, or a one-time explanation on the first headless denial.
- [ ] **`freecode run --agent` is an unchecked cast** (`run.ts:140`). `--agent buld`
      falls through `modeDefault`'s `default` branch and runs with **build**
      semantics. Add yargs `choices`, as `mcp add`'s `type` already has.
- [ ] **Shell hooks cannot set `modifiedOutput`.** `executeCommandHook` only ever
      returns `blocked` / `modifiedInput` / `additionalContext`, so the two events
      whose purpose is rewriting — `PostToolUse` (tool output) and
      `UserPromptSubmit` (`modifiedPrompt`, `UserPromptSubmit.ts:45`) — are inert
      from `settings.json`, which is the only place a user can define a hook.
      Accept a `modifiedOutput` key in the JSON-stdout form.
- [ ] **`PostToolUse` hooks never see the tool's output.** `runPostToolUseHooks`
      takes the `ToolResult` and drops it, passing only the tool input
      (`PostToolUse.ts:23`). `createPostToolUseInput()` in the same file *does*
      include `result` and has **zero callers** — written, never wired.
- [ ] **`UserPromptSubmit` receives only `{ promptLength }`** — a hook expected to
      rewrite or veto a prompt cannot read it.
- [ ] **Non-zero exit is ignored when a hook prints JSON.** `command.ts` checks exit
      `2`, then parses JSON, then checks exit `0` — so `{"block":false}` + `exit 1`
      continues. Honour the exit code or state that JSON overrides it.
- [ ] **`settings.json` has three loaders and three different merge rules.**
      `permissions` concatenates both scopes, `hooks` override by `event + name`,
      `memory` takes the first definition (project → user → default). Nothing states
      the difference and `/getting-started/configuration` claims a single "project
      wins" rule that only holds for hooks. One loader that parses the file once and
      hands each subsystem its section would make one answer true.
- [ ] **Unknown `settings.json` keys are silently ignored.** `"permission"` for
      `"permissions"`, or a misspelled hook field, produces no warning — identical
      from the outside to the feature being broken. Each loader already warns on
      malformed input.
- [ ] **No JSON Schema for `settings.json`.** No `$schema`, no generated schema, so
      editors cannot complete or validate a hand-edited, security-relevant file.
- [ ] **`FREECODE_HOME` is read in exactly one place** — the updater's
      `builds/stable/freecode` lookup (`apps/tui/src/entry.ts:101`). Every data path
      (`config.json`, `sessions/`, `projects/`, `rollout/`, `history.jsonl`) builds
      from `os.homedir()` directly, so setting it produces a half-relocated install.
      Honour it through one `freecodeHome()` helper, or rename it.
- [ ] **Six env vars need a process restart and nothing says so** —
      `FREECODE_TOOL_RESULT_BUDGET_CHARS` (`loop.ts:152`) and the five
      `FREECODE_OUTPUT_*` values (`tools/output-store/config.ts`) are module-load
      consts, while the compaction and cache vars are deliberately read per call.
- [ ] **`FREECODE_TOOL_RESULT_BUDGET_CHARS=""` silently means 0** — `Number("")` is
      finite, so an empty export sets the budget to zero instead of falling back to
      the default like every other numeric variable.
- [ ] **`graph.explore` breaks the memory naming convention** and hard-codes
      `process.cwd()` while every neighbouring `memory.*` method takes `projectPath`.
- [ ] **`config.get` returns API keys verbatim.** Fine over a local stdio pipe,
      wrong the moment the backend is reachable another way; no redaction anywhere.
- [ ] **MCP servers are user-scope only.** `getConfigDir()` is hard-wired to
      `~/.freecode` (`cli/utils/config.ts`), so a repository cannot ship the MCP
      servers its contributors need the way it can ship rules and hooks.
- [ ] **`freecode session` exposes 2 of 12 session operations.** `fork`, `switch`,
      `archive`, `export`, `import`, `upload`, `download` are IPC-only, so scripting
      session management means speaking JSON-RPC by hand.
- [ ] **`freecode uninstall` deletes user data on one `y`.** It removes all of
      `~/.freecode` — sessions, rollout logs, memory, history, usage — and the prompt
      does not say so. No `--keep-data`, no backup.
- [ ] **No way to print effective configuration.** Diagnosing "why is it compacting
      so early" means reading source. A `freecode config env` dumping
      name / default / effective / source would pay for itself.

### Deliberate — do NOT "fix"

- **Hook exit codes fail closed, timeouts fail open.** A hook that answered is
  trusted; a hook that never answered is skipped. Both directions are intentional.
- **`permissions` merges rather than overrides across scopes.** Deny is checked
  first, so a project can neutralize a user-scope allow by adding a deny — it just
  cannot delete it. That is the safe direction for a file that travels with a repo.
- **Bash prefix rules refuse compound commands.** `Bash(npm:*)` never matches
  `npm test && rm -rf /`; the word-boundary and shell-separator checks are the
  security property, not an oversight.
- **MCP argument patterns never match.** `mcp__linear(x)` fails closed by design;
  server-level rules are the supported granularity in v1.
- **Hook payloads are env vars, not stdin JSON.** A three-line bash script is a
  complete hook implementation in any language, with nothing to parse.

## Docs-audit findings (agent loop — 2026-08-23)

Found while writing `apps/docs/app/internals/agent-loop`. Each is also listed in
that page's **Known gaps**.

### Real fixes

- [ ] **`PruneState` doesn't survive the user turn, so it invalidates the cache it
      exists to protect.** It is a private field (`loop.ts:315`) and a fresh
      `AgentLoop` is constructed per user message (`server.ts:199`), so on message
      N+1 every tool result is `fresh` again and a result previously sent as a
      marker is re-sent at full size — mutating the prefix at message granularity
      instead of turn granularity. Candidate ids are derived deterministically from
      persisted message ids (`loop.ts:379`), so keying the state by `sessionId` —
      as `read-state` and `cache-awareness` already do — fixes it without changing
      the algorithm.
- [ ] **The `Stop` hook never fires on a normal finish.** Only `stop()`
      (`loop.ts:2455`) runs it: iteration cap, loop-health stop, spend budget. The
      `"Done"` path returns straight from `complete()` (`loop.ts:938`) and `fail()`
      doesn't call it either, so "notify me when the agent is done" only fires when
      it ends badly. `/internals/hooks` currently describes it as "when the loop
      terminates".
- [ ] **`SessionStart` fires per user message, not per session** (`loop.ts:593`,
      inside `run()`). Either rename it or gate it on the session's first run.
- [ ] **The tree watcher can't reach the current session's prompt.** `run()` calls
      `ensureWatching` (`loop.ts:564`) to keep project context fresh, but the
      prompt reads `getFrozenSessionContext` (`context/session-context.ts:39`),
      which snapshots once per session. The freeze is correct for cache
      stability, so the watcher's only real payoff is a fresh snapshot for the
      *next* session — and that payoff is itself cancelled for up to 5 minutes by
      `PromptCompiler`'s `fileTreeCache` (keyed on git HEAD, value derived from
      the tree; see the context-engine audit below). Meanwhile a long session's
      file tree is permanently the one from its first turn. Fix the compiler cache
      key first, then consider giving the freeze an explicit refresh point (e.g.
      after compaction, which rebuilds the prefix anyway).
- [ ] **`ToolContext.projectPath` is never set by the loop.** `executeTool` builds
      `{ cwd: process.cwd(), sessionId, abort }` (`loop.ts:2199`), so relative paths
      resolve against core's working directory rather than `state.projectPath`, and
      `lsp` / `memory` (which read `ctx.projectPath ?? ctx.cwd`) act on the wrong
      project whenever core was launched elsewhere.
- [ ] **The `agent` tool spawns subagents on an unregistered provider.**
      `provider: params.agentType || "chatgpt"` (`tools/agent.ts:126`) while
      `initProviders` registers only anthropic/openai/gemini/minimax/deepseek/zai
      (`providers/registry.ts:35`), so `getProvider` throws on the subagent's first
      turn unless the model puts a real provider id in a field whose description
      calls it an agent type. It also drops the parent's model and omits
      `memoryExtraction: false`, which `agent/subagent.ts:70` sets for the same
      reason.
- [ ] **Loop-health heuristic D was never implemented.** `recentReasoning`
      (`loop.ts:276`) is declared and never written, `repeatedReasoningScore` is
      permanently 0, and `reasoningSimilarityThreshold` / `reasoningSimilarityTurns`
      (`agent/types.ts:206`) have no reader. Implement it or delete the fields —
      right now the spec advertises four heuristics and three exist.
- [x] **"No progress" counted tool calls, not turns.** ✅ Phase 0 of
      `specs/2026-08-26-trajectory-redirection.md` (D1). `stagnantTurns` now advances
      once per turn in `AgentLoop.advanceStagnation()` (`loop.ts:2498`) — five
      consecutive reads no longer read as stagnation — and `oscillationScore` is a
      count of reverts still inside the 30-edit window (`countReverts`,
      `agent/oscillation.ts`) instead of a counter that only ever climbed. Tests:
      `agent/stagnation.test.ts`, `agent/oscillation.test.ts`.
- [x] **`no_progress` fired on healthy read-only exploration.** ✅ Fixed
      2026-08-27. Found by the Phase 2 eval probe, not by reading the code: in
      plan/review/explore nothing the agent is *permitted* to do can reset
      `stagnantTurns`, so it climbed to the threshold on any exploration past five
      turns and stayed there. Harmless while a warn was only `logger.debug`; with
      redirection on it is a model call billed for doing exactly what the mode is
      for. `advanceStagnation()` now skips read-only modes (`isReadOnlyMode()`,
      `permission/mode-policy.ts`), tested over all three.
- [ ] **A loop-health `warn` still reaches nobody by default.** The signal is now trustworthy,
      but every `warn` goes to `logger.debug` (`loop.ts:737`) — invisible at the
      default log level and never shown to the model, so nothing acts on a stuck
      pattern until it doubles into a `stop`. Phase 1 of
      `specs/2026-08-26-trajectory-redirection.md`.
- [x] **Loop health was implemented twice.** ✅ Phase 0 (D10). The private
      `AgentLoop.evaluateLoopHealth()` is deleted; the loop now calls
      `createLoopHealthEvaluator()` from `effect/loop-health.ts`, which is the only
      copy of the policy.
- [ ] **The provider tool list ignores agent mode.** `getToolDefs()`
      (`tools/defs-cache.ts:30`) takes no mode, so a plan-mode session advertises
      `write`/`edit`/`bash` and then hard-denies them (`mode-policy.ts:77`) — one
      wasted round trip to learn something the harness already knew.
- [ ] **`validateParams` in the orchestrator is dead** (`tools/orchestrator.ts:64`)
      — defined, never called. Required-argument checking therefore happens only in
      a tool's own `validateInput`.
- [ ] **`RecoveryManager.shouldRetryTool` has no production caller.** The
      orchestrator re-implements the rule inline (`tools/orchestrator.ts:202`); the
      interface method is exercised only by `recovery/manager.test.ts`.
- [ ] **`generateSessionTitle` is dead code** (`agent/title-generator.ts:43`).
      `server.ts:232` uses the `SESSION_TITLE:` regex plus
      `generateTitleFromPrompt`, so the LLM-backed titler is never reached.
- [ ] **`turn.started` is recorded after the model responds** (`loop.ts:1411`), so
      it cannot bracket the call it names; `model.request` is the real turn start.
- [ ] **`[TOOL_CALLS]` parsing exists twice** with independent implementations —
      `loop.ts:1959` and `session/normalize/index.ts:77`.
- [ ] **`estimatePromptChars` ignores tool-call arguments** (`loop.ts:218`) — it
      sums text, code, image and tool *results*, so a large `write` payload is
      invisible in the trace's `promptChars`.
- [ ] **Headless runs are unbounded and there is no flag to bound them.**
      `loop.ts:324` says headless/`-p` invocations pass `maxIterations` explicitly;
      `cli/commands/run.ts:145` doesn't, and its own comment points at a
      `--max-turns` option that was never added. So an unattended `freecode run`
      has no turn cap at all — only loop-health and the gates. Add the flag, or fix
      both comments.
- [ ] **The spend circuit breaker is off by default** (`loop.ts:812`,
      `compaction/tokens.ts:105`). `FREECODE_MAX_TURN_TOKENS` is unset unless the
      user sets it, so nothing caps actual spend. Combined with the item above, an
      unattended run has neither a turn cap nor a token cap, and loop-health only
      *warns* on the stuck patterns most likely to burn quota (stagnation never
      stops at all). Consider a default ceiling for headless runs.

### Deliberate — do NOT "fix"

- **Dynamic context is a user message at position 0, not a system block.** The
  static system block stays a stable cacheable prefix only because the tree, git
  HEAD and clock live below it, with a fixed id and `timestamp: 0`.
- **The project snapshot and the clock are frozen per session.** A fresher tree
  costs the entire conversation prefix; an hour-rounded clock exists so position 0
  doesn't rewrite itself on the hour boundary.
- **A frozen tool result is never shrunk.** Saving ~250 tokens by replacing a
  result already in the cached prefix costs a partial invalidation worth far more.
- **Oscillation scores inverse edits, not repeated edits.** Editing one file many
  times is what real work on a large file looks like.
- **Loop-health braking is two-tier (warn at 1×, stop at 2×).** Long legitimate
  tasks routinely breach the first threshold.
- **Memory extraction is fired without `await`.** The user's result must not wait
  on it, and a memory failure must never surface as a task failure.
- **`compactAndRetry` does not re-wrap its retry.** A second overflow in one turn
  means compaction isn't converging; looping burns quota.
- **A quota-exhausted 429 is never retried.** Waiting cannot help, and each retry
  re-sends the whole conversation for a guaranteed rejection.
- **Provider errors are stringified before they reach logs or the bus.** The SDK
  error carries the entire request on `requestBodyValues`.

## Docs-audit findings (provider layer — 2026-08-23)

Found while writing `apps/docs/app/internals/providers`. Each is also listed in
that page's **Known gaps**.

### Real fixes

- [ ] **Gemini's provider id doesn't exist on models.dev — highest-impact item
      here.** FreeCode registers `gemini`; models.dev calls it `google` (verified
      against the cached catalogue: `google` has 39 models, `gemini` is absent).
      So every lookup fails for the provider with the largest windows:
      `getModelContextLimit` → `0`, so `resolveContextLimit` returns `undefined`
      and compaction budgets against the 100K offline floor instead of 1M;
      `models.list` → `[]`, so the picker shows no Gemini models;
      `modelSupportsImages` → `false`, so images are never sent to Gemini and the
      user is advised to "switch to a vision model (e.g. an Anthropic, OpenAI, or
      Gemini model)". The other five ids resolve. Fix with an id-mapping table in
      `models-dev.ts` (`gemini → google`), and check the reverse direction before
      adding any future provider.
- [ ] **`providers.list` returns models.dev's whole catalogue, not FreeCode's
      providers.** `server.ts:618` calls `getProviders()` — 200+ entries such as
      `hpc-ai`, `qiniu-ai`, `zenifra` — and runs `hasApiKey` against ids the
      registry cannot instantiate, so choosing one fails with
      `Provider "X" not registered`. The registry's own `listProviders()` is
      imported at `server.ts:14` and never used. Either return the registry list
      (joined with models.dev metadata) or filter the catalogue by registered id.
- [ ] **`getProvider()` builds a fresh SDK client per call and reads config from
      disk each time.** `registry.ts:24` calls `def.create("")` on every lookup;
      each adapter's factory calls `getApiKey()`, which does a synchronous
      `readFileSync` + `JSON.parse` of `~/.freecode/config.json`. That is a
      blocking disk read at least once per turn (`callProviderOnce`) plus once per
      compaction (`compactOptions`). Memoize per provider id, invalidating when
      config changes.
- [ ] **`readConfig()` throws on a malformed `config.json`** (`config.ts:39`,
      bare `JSON.parse`). It propagates out of `createRecoveryManagerFromConfig()`
      during loop construction, so a stray comma takes down the session rather
      than degrading. Every other settings loader warns and falls back.
- [ ] **`summarizeCache`'s hit ratio is both wrong and unused.**
      `read / (read + inputTokens)` (`cache-awareness.ts:71`) treats `inputTokens`
      as the fresh portion, but `NormalizedUsage.inputTokens` is inclusive of
      cache reads and writes — so reads are double-counted in the denominator.
      Nothing outside `cache-awareness.test.ts:38` reads `hitRatio` (the loop
      destructures only `readTokens`/`writeTokens`), and the test asserts the old
      non-inclusive semantics. Either fix to
      `read / (read + nonCachedInputTokens + write)` and use it, or delete it.
- [ ] **A total cache failure is invisible to the miss detector.**
      `emitCacheWarm` returns before `checkCacheHealth` when reads and writes are
      both zero (`loop.ts:1910`), and `checkCacheUsage`'s `!reportsCache` branch
      would bail anyway (`cache-miss.ts:82`) — so `expected_read_missing` is
      reachable only when a write happened. "Caching stopped entirely" is the case
      most worth alarming on.
- [ ] **Only `anthropic` is treated as a caching provider for the cold warning.**
      `CACHING_PROVIDERS` (`cache-awareness.ts:24`) is a one-element set, but
      `minimax` and `zai` use the same Anthropic endpoint shape and carry the same
      `cacheControl` markers, so their users never see the cold-cache warning.
- [ ] **A changing tool set busts the prompt cache with nothing in the
      journal.** `invalidateToolDefs()` (`tools/defs-cache.ts:49`) fires on
      `tools.changed` / `mcp.tools.changed`; the tools array sits inside the
      cached prefix, so the next request necessarily misses. No
      `recordInvalidation` call, so the detector reports an unexplained bust —
      the false positive the journal exists to prevent.
- [ ] **`ProviderRegistryTag` has no consumer.** Defined at
      `effect/context.ts:60` and wired into both live and test layers
      (`effect/layers.ts:68`, `:182`), but nothing resolves it — the loop calls
      `getProvider()` directly, so the seam that would let a test swap providers
      is inert.
- [ ] **`ProviderDefinition.create(apiKey)` ignores its argument.** All six
      adapters take `_apiKey` and call `getApiKey()` themselves; `getProvider`
      passes `""`. Drop the parameter or actually thread the key through it.
- [ ] **`ExecuteResult.thinking` is dead for every provider.** All six set
      `thinking: undefined` in `execute()`; reasoning reaches the loop only as
      `thinking_delta` on the streaming path, so a non-streaming turn loses
      extended thinking silently. Related: there is no thinking-budget or
      reasoning-effort field anywhere in `ExecuteOptions`.
- [ ] **`ProviderInfo.maxOutputTokens`'s doc comment is stale** (`types.ts:10`).
      It says compaction subtracts it; compaction subtracts
      `resolveMaxOutputTokens()` (models.dev ∧ `OUTPUT_TOKEN_CAP`). The field is
      only a fallback for callers that omit `maxTokens`, and it is 4096 for four
      of the six providers.
- [ ] **`session/normalize/` is unreachable dead code.** The v4 spec describes a
      `ProviderResponseNormalizer` layer with per-provider modules; nothing
      imports it. Real normalization is `streaming.ts` + `mapUsage`. It also holds
      a second `[TOOL_CALLS]` parser duplicating `loop.ts:1959`.
- [ ] **`browser/` has zero importers.** `CLAUDE.md` calls the Playwright path
      "legacy / not wired into the primary path"; it is actually unreachable — no
      file outside the directory imports it, and `chatgpt` is not registered.
      Decide: delete it, or wire it behind a flag and say so.

### Deliberate — do NOT "fix"

- **`PROVIDER_MAX_RETRIES = 0`.** The SDK's own retries multiply with
  `RecoveryManager`'s (3 × 5 = up to 15 full-conversation round trips per turn)
  and it treats an unpayable quota 429 as retryable.
- **Cache markers are set for every provider flavour at once.** The SDK routes
  `providerOptions` by key and ignores the rest, so a model reached through a
  gateway caches as well as a direct one, for free.
- **`ttl` is omitted at 5m rather than sent explicitly.** 5m is the server-side
  default, so omitting it keeps request bytes identical to the pre-knob build —
  the default path cannot regress.
- **The read anchor is the message *before* the newest assistant message, not
  `.slice(-2)`.** `convertToCoreMessages` expands one turn into two messages, so
  the two-back rule lands on two messages that are both new (measured: reads
  pinned at ~7K while input grew to 81K).
- **The last tool carries a cache breakpoint.** Anthropic caches up to and
  including a marked block, so one marker caches the whole tools array; the
  name-sorted tool list is what keeps "last" stable.
- **Malformed tool arguments fail the turn instead of being cast.** The AI SDK
  emits the raw JSON string as `input`; storing it poisons the session
  permanently, because it is re-sent every turn and rejected before reaching the
  model.
- **Timeouts sit at the fetch layer, never around `ProviderChunk`s.**
  `normalizeAiSdkStream` drops `tool-input-delta`, so a large tool call looks
  like a dead stream from above it.
- **`mapUsage` returns `undefined` rather than `0` for unknown counts**, so "no
  usage data" stays distinguishable from a real zero.
- **`modelSupportsImages` fails closed on an unknown model.** An image part sent
  to a text-only model is a hard 400.

## Docs-audit findings (tool system — 2026-08-23)

Found while writing `apps/docs/app/internals/tools`. Each is also listed in that
page's **Known gaps**.

### Real fixes

- [ ] **An ambiguous `edit` silently rewrites the LAST occurrence.** For a
      non-`replaceAll` edit, `applyEdit` iterates every candidate and skips until
      `startIndex === content.lastIndexOf(match)` (`edit.ts:543`), so an
      `oldString` occurring three times is applied to the third with no error and
      no warning. The model has usually just read the top of a file and means the
      first. Claude Code and opencode both hard-fail ("found N matches, provide
      more context"); do the same when `simpleReplacer` yields more than one
      candidate and `replaceAll` is false.
- [ ] **`bash` and `agent` declare `isDestructive: false`** (`bash.ts:293`,
      `agent.ts:233`). Only `edit` and `write` declare `true`, and four consumers
      read the flag: the verify gate (`filesMutatedThisRun`) — so a run that edits
      via `sed -i`, `git apply` or a codemod never triggers typecheck; the
      verifier gate (`mutatedFiles` stays empty); loop-health stagnation — so
      bash-only work always looks like no progress; and the orchestrator's retry
      rule (`orchestrator.ts:202`), whose own comment says "re-running a
      write/edit/bash is not safe" while the data makes bash retryable. It also
      contradicts `permission/mode-policy.ts`, which correctly treats both as
      mutating. Fix the flags, or split "mutates the filesystem" from "unsafe to
      re-run" into two fields.
- [ ] **Mutating MCP tools are marked concurrency-safe.** `convertMcpTool` sets
      `isConcurrencySafe: true` unconditionally (`convert-tool.ts:36`) while
      deriving `isDestructive` from `readOnlyHint` two lines below, so a batch of
      MCP mutations runs in parallel via `planToolBatches`. Should be
      `isConcurrencySafe: isReadOnly`.
- [ ] **MCP schema conversion loses `required`, `items` and nested
      `properties`.** `convertJsonSchema` returns `{ type, properties }` with no
      `required`, and `convertProperty` keeps only `description`/`type`/`enum`
      (`convert-tool.ts:79-111`). Consequences: required fields are never declared
      to the provider; array element types are gone; `coerceArgs` cannot descend
      into object/array parameters; and any schema that isn't a plain
      object-with-properties (`$ref`, `allOf`, `oneOf`) collapses to
      `{ type: "object" }`, telling the model the tool takes no parameters.
- [ ] **`validateParams` is dead** (`orchestrator.ts:64`) — defined, never
      called. Together with the item above, a missing required argument on an MCP
      tool is validated nowhere and surfaces as `undefined` inside the remote
      call. (Also listed in the agent-loop audit.)
- [ ] **Four `Tool` metadata fields have zero readers.**
      `behavior.maxResultSizeChars` (set by every tool and by MCP; truncation
      actually uses the global 30K `adaptiveTruncate` budget),
      `behavior.interruptBehavior`, `permissions.operations`, and
      `permissions.requiresApproval` — `bash.ts:290` sets the last to `true` and
      nothing consults it. Either wire them or delete them; right now they read as
      a working permission model that isn't.
- [ ] **`getPath` and `isSearchOrReadCommand` are implemented widely and read
      nowhere.** `getPath` is shadowed by `extractTarget` + `PATH_TOOLS`
      (`permission/rules.ts`), which is what `CLAUDE.md`'s registration checklist
      tells contributors to update — two independent answers to "which path does
      this tool touch", one of them live. `isSearchOrReadCommand` has no consumer
      at all.
- [ ] **`checkPermissions` has no implementers.** The orchestrator calls it when
      present (`orchestrator.ts:107`); no tool defines it.
- [ ] **Permission profiles are unreachable.** `createToolOrchestrator()` is
      called with no arguments at all three production sites (`loop.ts:331`,
      `effect/layers.ts:63`, `:179`), so `permissionProfile` is always `undefined`
      and the `isToolAllowed` branch (`orchestrator.ts:145`, `:286`) never runs.
      `CLAUDE.md` says profiles are "used for subagents" — they are used nowhere.
      Either pass a profile when spawning a subagent or drop `profiles.ts`.
- [ ] **The todo list is in-memory only** (`todo.ts:25`). It survives compaction
      (re-rendered from the store each turn rather than read out of history) but
      not a restart or `session.resume` — and the loop's todo-completion gate
      reads the same store, so a resumed session's plan is silently empty and the
      gate can never fire. Persist it next to the session, like the rollout log.
- [ ] **`executeTool` in `factory.ts:88` is dead code**, exported and re-exported
      from `tools/index.ts` but called by nothing; it also implements a different
      result contract from the orchestrator's.
- [ ] **`tool_complete` streams the full untruncated output over IPC.** The
      event carries `result.stdout` (`loop.ts:2280`), correct for rendering but
      uncapped — a 10 MB `bash` result crosses the boundary in one message.
      Consider a display cap with a "show more" fetch, mirroring the `output`
      tool.
- [ ] **`read`'s image path pays before the visibility check.** The tool
      base64-encodes any supported image up to 10 MB and returns it as
      `metadata.image`; whether the model can see images is only decided later in
      the loop (`loop.ts:1525`). A text-only model pays the full read and gets a
      "not sent" notice. Push `modelSupportsImages` into the tool, or pass the
      capability through `ToolContext`.

### Deliberate — do NOT "fix"

- **Coercion is narrow: only an unambiguous numeric literal or exactly
  `"true"`/`"false"`.** `Number()`/truthiness turns `""` into `0` and `"false"`
  into `true`, hiding a malformed call instead of letting the validator surface
  it.
- **Coercion lives at the orchestrator boundary, not in each `execute()`.** The
  declared schema `type` is already the single source of truth, and MCP schemas
  can't be patched per tool.
- **Truncation keeps a head *and* a tail.** Build errors, stack traces and
  summaries live at the end; head-only threw away exactly what was needed.
- **Both truncation cuts snap to line boundaries.** A raw character index lands
  mid-token and the model reads a half-identifier as whole.
- **An `OutputStore` miss returns a message, never an error.** Degrading to
  "re-run the tool" is always recoverable.
- **`edit`/`write` record read-state but are excluded from dedup.** They record
  content the model has never been shown; deduping against it would claim "you
  already have this" while the transcript holds the pre-edit text.
- **Read dedup has a kill switch (`FREECODE_READ_DEDUP=0`).** It is the only
  token-efficiency measure that changes what the model *sees*.
- **An unannotated MCP tool is treated as mutating.** An absent `readOnlyHint`
  says nothing about the tool; guessing "harmless" is how `create_issue` gets
  re-run.
- **Tool defs are sorted by name.** `buildToolsParam` marks the last tool with a
  cache breakpoint, so a stable order is what keeps the tools block cacheable.
- **A `bash` timeout resolves as a failure, not a slow success**, with partial
  output attached — otherwise the loop concludes the command worked.
- **Tools return data, never markup.** Four frontends render the same
  `StreamEvent`s their own way.

## Docs-audit findings (getting started — 2026-08-23)

Found while writing `apps/docs/app/getting-started` (installation, quickstart,
providers, configuration). Each is also listed in that page's **Known gaps**.
Items already tracked elsewhere (`providers.list` returning models.dev's whole
catalogue, the `gemini`/`google` id mismatch, hooks not loading under
`freecode run`, MCP being user-scope only, root-only instruction files) are cited
on the pages but not repeated here.

### Real fixes

- [ ] **First run has no path to a working session that the product itself
      teaches.** A fresh `config.json` has no `current.provider`, so the first
      prompt dies with `No provider configured. Set current.provider in
      ~/.freecode/config.json, or pass \`provider\` to session.start`
      (`server.ts:281`) — a message written for an integrator. It names a file to
      hand-edit and never mentions `/model`, which is the only supported path.
      Detect a missing `current` at TUI startup and open the model picker.
- [ ] **`ANTHROPIC_API_KEY` (etc.) looks sufficient and is not.** `hasApiKey`
      reads the environment (`providers/config.ts:116`) so the key resolves, but
      the session still refuses to start without `current.provider`. Env-only
      configuration works headlessly (`--model anthropic/…` supplies the
      provider) and never interactively — which is backwards from every other CLI
      that reads a `*_API_KEY`.
- [ ] **`config.json` silently outranks the environment for API keys.**
      `getApiKey` (`providers/config.ts:59`) checks the stored key first, so
      `ANTHROPIC_API_KEY=… freecode` does *not* override a key pasted months ago,
      and nothing reports which of the four sources was used. The other two
      configuration surfaces let the environment win.
- [ ] **The auto-update cannot be disabled and no version can be pinned.**
      `checkForUpdate` (`apps/tui/src/entry.ts:56`) gates only on
      `FREECODE_BUNDLED` and a per-process sentinel — no flag, no env var, no
      config key. Running an older binary from `builds/versions/<old>/` installs
      the latest and re-execs into it, so the versioned layout that makes
      rollback look supported cannot actually hold a version. `FREECODE_NO_UPDATE=1`
      would be a one-line fix.
- [ ] **`freecode uninstall` ignores the variables the installer honours.** The
      handler hard-codes `~/.freecode` plus four Unix bin paths
      (`cli/commands/uninstall.ts:44`), while `install.sh` supports
      `FREECODE_HOME` and `FREECODE_INSTALL_DIR` and `install.ps1` installs the
      launcher to `%LOCALAPPDATA%\freecode\bin`. On Windows the command reports
      success while leaving the binary on PATH.
- [ ] **Nothing removes the PATH lines the installer appended.** `install.sh`
      writes an `export PATH=…` block into `~/.zshenv`, `~/.bashrc`,
      `~/.profile`, fish's `config.fish`, and any existing `~/.zshrc` /
      `~/.zprofile` / `~/.bash_profile`; uninstalling leaves every one of them
      pointing at a directory that no longer exists.
- [ ] **`apps/tui/src/models.ts` is stale dead code.** `AVAILABLE_MODELS`
      hard-codes three Anthropic model ids and is imported by
      `commands/built-in.ts:2` without being used — the picker gets its list from
      `models.list` over IPC. A hard-coded model table in a frontend that is not
      allowed to have one.
- [ ] **`TODO.md`'s own entry for user-defined commands is stale.** "User-defined
      prompt commands loader — **Status:** Not started" is contradicted by
      `commands/loader.ts:113`, which already loads `.freecode/commands/` from
      project and user scope with precedence. Same for the extensibility item 2.

## Docs-audit findings (context engine — 2026-08-23)

Found while writing `apps/docs/app/internals/context`. Each is also listed in
that page's **Known gaps**.

### Real fixes

- [ ] **The git HEAD never reaches the model.** It is computed with an `execSync`
      per cache miss (`tree-cache.ts:38`), carried on `ProjectContext`, frozen per
      session, threaded through `run()` → `callProviderOnce` →
      `compileDynamicContext` — and `compileProjectSummary` uses it only as a
      **cache key**. The rendered section is `Project` / `Path` / `File tree` and
      nothing else (`compiler.ts:115`). `CLAUDE.md` ("file tree, git head") and
      several in-code comments claim otherwise. Either render it or stop computing
      it.
- [ ] **`PromptCompiler.fileTreeCache` is keyed on something its value doesn't
      depend on.** Key is `projectPath:gitHead:ignorePatterns` (`compiler.ts:59`);
      the cached string is built from `tree`, which changes independently of HEAD
      (any new top-level file). A second session started within the 5-minute TTL
      renders the *first* session's tree even though the tree-watcher just
      refreshed `tree-cache` — cancelling the watcher's only remaining benefit.
      The cache saves a four-line string concat, so the simplest fix is to delete
      it; otherwise key it on the tree itself.
- [ ] **`collector.ts` + `context/types.ts` + `context/strategies/` are
      unreachable.** `collectContext()` resolves a strategy from a registry that
      only `createDefaultStrategies()` fills, and that function has no callers — so
      the lookup would fail even if something invoked it. Nothing does:
      `AgentLoop.collectContext` (`loop.ts:2295`) is a private method calling
      `getFrozenSessionContext`. Delete the trio, or wire it and drop `tree-cache`'s
      parallel implementation.
- [ ] **`FileTreeStrategy` implements the design the project explicitly
      rejected** — depth-3 walk reading the **full contents of every file** into
      `files` (`strategies/file-tree.ts:90`), i.e. the "collect files then send
      them" pre-pass the single-agentic-loop architecture exists to avoid. Dead,
      but 126 lines of dead code that reads like the intended design. It also
      builds keys with `path.relative(process.cwd(), …)` instead of the project
      path.
- [ ] **`ProjectContext` is declared twice with different fields** —
      `context/types.ts:5` (dead: `{ projectPath, name, tree, files, metadata }`)
      and `context/tree-cache.ts:14` (live: `{ name, projectPath, tree, gitHead }`).
- [ ] **Editing `CLAUDE.md` mid-session busts the prompt cache with nothing in
      the invalidation journal.** `compileInstructionsSection` re-reads from disk
      every turn and feeds the `cache: true` block, so an edit moves the first
      breakpoint. Legitimate, but no `recordInvalidation` call — so the miss
      detector reports an unexplained bust. Same shape as the MCP tool-set gap in
      the provider-layer audit; both want a `recordInvalidation` at the site that
      changes the prefix.
- [ ] **The 40,000-char instruction cap truncates mid-file, after joining, with
      global first** (`instructions.ts:46`). A large global `CLAUDE.md` can push
      the project's own instructions out of the prompt entirely, and the marker
      names the character count but not which file was cut. Cap per file, or at
      least name the casualty.
- [ ] **`invalidateSymbolCache` has no callers** (`repo-map/index.ts:196`). The
      whole-project symbol cache relies on git HEAD + a 5-minute TTL, so
      uncommitted edits inside that window return stale `workspaceSymbol` results.
      The tree-watcher already detects the relevant changes and could call it.
- [ ] **`compileDynamicContext`'s `memoryContext` and `ignorePatterns` are
      permanently dead parameters** (`compiler.ts:185`). Both are always passed
      empty by the only caller. `memoryContext` is load-bearing in reverse — the
      comment explaining why it must never be used is the real documentation — so
      keep the comment, drop the parameter.
- [ ] **The prompt's "file tree" is a single non-recursive `readdirSync` of the
      project root** (`tree-cache.ts:29`). That is a defensible floor, but the word
      "tree" in `CLAUDE.md`, in the compiler's own output header, and in the docs
      oversells it. Rename it, or make the depth a knob.

### Deliberate — do NOT "fix"

- **The project snapshot is one level deep.** The model has `ls`/`glob`/`grep`; a
  recursive monorepo listing would cost thousands of tokens *every turn* to say
  what one tool call can answer.
- **The snapshot and clock are frozen per session.** A fresher tree rewrites
  position 0 and invalidates the entire conversation prefix.
- **Dynamic context is `messages[0]`, not a system block.** The static system
  block stays cacheable only because everything that moves lives below it.
- **`memoryContext` is never rendered into position 0.** It rendered
  `recentMessages`, which grow every turn and are already in the history verbatim.
- **Skills are advertised as name + description only, sorted.** Full bodies load
  on demand via the `skill` tool; the sort keeps identical skill sets producing
  identical bytes.
- **Nothing from `repo-map/` is injected into the prompt.** The pull model means
  symbols cost tokens only when the model asks for them.
- **`getFileSymbols` parses fresh rather than reading the project cache.**
  Single-file results must never be stale.
- **The tree-watcher runs `persistent: false`.** A watcher that keeps the process
  alive hangs every short-lived CLI invocation that ran one turn.
- **The system-prompt loader tries disk before the embedded copy.** Dev picks up
  `system.md` edits without a rebuild; the compiled binary has no disk copy to
  find.

## Spec findings (eval harness — 2026-08-23)

From writing `docs/superpowers/specs/2026-08-23-eval-harness.md`. Details in that
spec's §12; these are the parts that are actionable independently of it.

### Real fixes

- [x] **The trace fold discards tool call arguments** — ✅ DONE (Phase 0).
      `ToolSpan.args` is carried through (`rollout/trace.ts:58,149,158`) and
      `scorers/trajectory.ts` scores `expectInArgs` off it. Original finding:
      (`rollout/trace.ts:137-139`).
      `FunctionCallEvent` carries `args: Record<string, unknown>`, but the
      `function.call` case folds it into nothing but a timestamp in `pendingTools`,
      so `ToolSpan` is `{ tool, startedAt, duration_ms }` and the args are gone.
      The log recorded the right thing and the fold throws it away. Carrying
      `args` through is ~3 lines, makes `freecode trace --json` materially more
      useful, and is a hard prerequisite for the eval harness's `expect_in_args`
      (spec §5.1, Phase 0).
- [ ] **There is no cost accounting in USD anywhere.** `usage/tracker.ts` records
      tokens and `usage.get` serves them, but a price table exists in exactly one
      file — `providers/minimax.ts`. A shared `providers/pricing.ts` keyed by
      `provider/model` would give `freecode trace`, `usage.get`, and the eval
      harness's efficiency scorer a real number. Without it, "this change made
      every turn 18% more expensive" is undetectable.
- [ ] **OTLP export has no session-level root span** (`rollout/otlp.ts`). Model
      spans are emitted per call, so a multi-turn session renders in Langfuse as N
      unrelated LLM calls. An `invoke_agent` root span plus
      `gen_ai.conversation.id = sessionId` makes it one tree. Cheap — both are
      attribute additions in a file that already builds spans by hand.
- [ ] **Two specs promise a verifier that does not exist.**
      `2026-08-10-autonomous-runs-design.md` says the "verifier/evaluator decides
      completion when configured gates" are set, and
      `2026-08-08-continual-harness-design.md` lets the agent rewrite its own
      harness with no way to measure whether the rewrite helped. Both are blocked
      on the eval spec's Phase 1, and both should say so.

### Docs findings (writing `/internals/eval` — 2026-08-23)

- [x] **A `question` tool call kills the suite silently, exit 0.** ✅ Fixed
      2026-08-27 (`eval/runner.ts`): the runner subscribes to `question.asked` and
      rejects — the tool already recovers — and every trial has a wall-clock cap
      (`FREECODE_EVAL_TRIAL_TIMEOUT_MS`, default 5 min). Original report: hit on
      2026-08-26 running the trajectory suite for the first time:
      `todowrite-for-multistep` made the model ask a clarifying question and the
      process ended right there — no summary, no report, no verdict, exit code 0,
      remaining 8 cases never run. `askQuestion()` `unref()`s its 30-minute timer
      (`bus/index.ts:346`) so a pending question cannot hold the event loop open,
      and headless there is no frontend to answer it. Under `--gate` a CI job
      reads that as green. `runner.ts` should subscribe to `question.asked` and
      reject (the tool already recovers with "You can continue without this
      information"), plus cap each trial's wall clock. This is why
      `~/.freecode/eval_runs.jsonl` did not exist until 2026-08-26 — the suite had
      never once completed.
- [ ] **A closed gate records its own baseline, so a regression is forgiven on the
      next run.** `runSuite` calls `writeReport(report)` unconditionally
      (`eval/suite.ts:50`), and `baselineFor` is the *last* recorded run
      (`eval/report.ts:73`). 18/20 → 14/20 closes the gate; re-run at 14/20 and it
      opens, because both the count and `greenIds` now come from the 14/20 run.
      The delta rule is only honest if a closed gate refuses to become the
      baseline (or history records a `gated` flag that `baselineFor` skips).
      Confirmed live 2026-08-26: the Phase 0 comparison recorded 15/20 then
      14/20, so the next gated run baselines against the red 14/20.
- [ ] **`SuiteReport.model` records the CLI override, not the resolved model**
      (`eval/suite.ts:41`). With no `--model` it is `undefined`, so history cannot
      say which model produced a baseline, and a cheap local run compared against
      a CI baseline from another model looks like a regression with no way to see
      why. Record `RunnerConfig`'s resolved `provider/model` instead. Related:
      **none of the 20 shipped cases pins `model`**, though spec §11 requires it.
- [ ] **`evalsDir()` is CWD-relative** (`eval/dataset.ts:19`,
      `path.resolve("evals")`), so `freecode eval` fails with "no such suite"
      anywhere but the repo root unless `FREECODE_EVALS_DIR` is set. The shipped
      cases also reference FreeCode's own source paths, so the suite is
      repo-specific and nothing in `--help` says so.
- [ ] **`--gate` does not imply `--trials 3`.** Default is 1 = `pass@1`, the
      statistic spec §9.1 argues is too noisy to block on. Either default
      `--trials` to 3 when `--gate` is set, or warn.
- [ ] **No `pnpm eval` script.** `bench:recall` has one; this does not, so the
      only documented invocation from a source checkout is a raw `tsx` command.

### Docs findings (writing `/internals/eval` — 2026-08-23)

- [ ] **A closed gate records its own baseline, so a regression is forgiven on the
      next run.** `runSuite` calls `writeReport(report)` unconditionally
      (`eval/suite.ts:50`), and `baselineFor` is the *last* recorded run
      (`eval/report.ts:73`). 18/20 → 14/20 closes the gate; re-run at 14/20 and it
      opens, because both the count and `greenIds` now come from the 14/20 run.
      The delta rule is only honest if a closed gate refuses to become the
      baseline (or history records a `gated` flag that `baselineFor` skips).
- [ ] **`SuiteReport.model` records the CLI override, not the resolved model**
      (`eval/suite.ts:41`). With no `--model` it is `undefined`, so history cannot
      say which model produced a baseline, and a cheap local run compared against
      a CI baseline from another model looks like a regression with no way to see
      why. Record `RunnerConfig`'s resolved `provider/model` instead. Related:
      **none of the 20 shipped cases pins `model`**, though spec §11 requires it.
- [ ] **`evalsDir()` is CWD-relative** (`eval/dataset.ts:19`,
      `path.resolve("evals")`), so `freecode eval` fails with "no such suite"
      anywhere but the repo root unless `FREECODE_EVALS_DIR` is set. The shipped
      cases also reference FreeCode's own source paths, so the suite is
      repo-specific and nothing in `--help` says so.
- [ ] **`--gate` does not imply `--trials 3`.** Default is 1 = `pass@1`, the
      statistic spec §9.1 argues is too noisy to block on. Either default
      `--trials` to 3 when `--gate` is set, or warn.
- [ ] **No `pnpm eval` script.** `bench:recall` has one; this does not, so the
      only documented invocation from a source checkout is a raw `tsx` command.

### Docs findings (eval Phase 2 — sandbox + outcome scorer, 2026-08-27)

- [ ] **`bash` escapes the sandbox.** `eval/sandbox.ts` scopes the *file* tools
      and the runner's permission answers to the tmpdir, but a coding case needs
      `bash` and `bash` reaches the whole filesystem (spec §6.3 says so
      explicitly). Cases are trusted fixtures, so this is a limit rather than a
      live hole — but it is why `danger` mode still has no eval coverage, and
      why an untrusted case would need a container (spec §13).
- [ ] **Coding cases are synthetic and small.** Six dependency-free `.mjs`
      fixtures, three-to-four turns each. They catch a harness change that
      breaks editing outright; they will not catch one that degrades work on a
      real codebase. That is the Tier 2 sandbox, blocked on `node_modules`
      (spec §6.2).
- [ ] **`referencedFiles()` in `eval/dataset.ts` is a token scan.** It only
      catches script paths ending `.mjs`/`.cjs`/`.js`/`.json`, so a `verify`
      that reaches a fixture file some other way (a shell redirect, a path built
      inside `node -e`) is not validated at load and will fail at score time,
      reading as an agent failure. Deliberately narrow — broadening it to
      "anything path-shaped" rejects `node --test` — but the gap is real.
- [ ] **`immutable` is checked only against files the case seeded.** A case
      cannot assert "the agent created no new files", so an agent that leaves
      scratch files behind still passes. Nothing depends on this yet.

### Housekeeping

- [ ] **`TODO.md` has the `### Docs findings (writing /internals/eval —
      2026-08-23)` block twice, verbatim** (the run of five items appears at
      ~1094 and again at ~1137). Pre-existing; not touched while doing Phase 2.

### Deliberate — do NOT "fix"

- **Unit tests stay `*.test.ts` under `src/`.** The 98 existing tests are unit
  tests and must not migrate into `evals/`. A file under `evals/` runs a real
  agent turn; anything that doesn't belongs next to the code it tests. Conflating
  the two is exactly what dilutes the eval signal in the prior art.
- **OTLP export stays off the hot path.** Live streaming is deferred in
  `2026-08-10-agent-observability.md` §7 for a stated reason; shipping from the
  durable log costs only immediacy.

## Spec findings (memory consolidation — prior-art review 2026-08-23)

From reviewing `codex`, `jcode`, `mem0`, and `agentmemory` against
`docs/superpowers/specs/2026-08-23-memory-consolidation.md` (amended same day,
D12–D14). These are actionable independently of that spec's phases.

### Real fixes

- [x] **The keyword scorer has no IDF and no length normalization** —
      `mem-query.ts:19` awards +5 per description token pair and +1 per content
      token pair for substring overlap in either direction. A long memory
      therefore outranks a precise short one on stopword-ish overlap, and a term
      present in every memory scores the same as a rare one. Replace with BM25
      (`k1 1.2`, `b 0.75`); it is ~40 lines over a few hundred short documents
      and needs no dependency. Measured context: agentmemory's `benchmark/`
      puts BM25-only at 95.0% P@5 / 95.5% MRR vs dual-stream 90.0% / 95.4%, so
      lexical retrieval done properly is a peer of the vector path, not a
      degraded stand-in. Spec D1.
- [x] **`retrieve()` discards the cascade score** — it walks scored output
      (`graph/index.ts:288`) and returns bare `MemoryEntry[]`, which
      `prepareMemories` stashes. Any score-ordered rendering (the byte-cap
      degradation in spec D2) and any per-memory usage attribution (D12) needs a
      `{ entry, score }` shape plumbed through `retrieve` → `prepareMemories` →
      the session stash → `renderRetrievedMemories`.
- [x] **Injected memories are never attributed** — the loop knows exactly which
      memories it surfaced (`loop.ts:1297` emits `memory_injected`) and discards
      it. No memory carries a use count or a last-used date, so consolidation
      candidate selection, retention, and any claim that memory helps are all
      unfalsifiable. codex closes this with citations →
      `usage_count`/`last_usage` (`read/src/citations.rs`,
      `state/migrations/0016_memory_usage.sql`). Spec D12.
- [x] **No recall benchmark** — nothing measures retrieval quality, so every
      tuning constant is permanent guesswork and no change to `seed()` can be
      defended. jcode's `src/bin/memory_recall_bench.rs` is a working model:
      three cached stages (queries → pool → metrics), runs the *production*
      primitives, reports recall@k / MRR / nDCG with per-config LLM call and
      token accounting. LongMemEval-S is directly usable because it uses
      `all-MiniLM-L6-v2`, the embedder FreeCode already runs. Spec D14.

### Roadmap (needs its own spec, not a fix)

- **Progressive disclosure instead of a byte cap.** codex's always-loaded
  artifact is a navigational index (`memory_summary.md`) with bodies fetched on
  demand through a read-only memory-fs MCP server (`codex-rs/memories/mcp/`), so
  a long memory is never truncated, only not-yet-read. Strictly better than the
  spec's D2 byte cap, but it is a read-path redesign touching the MCP surface
  and prompt caching.
- **Backfill the rollout archive.** ~390 session directories under
  `~/.freecode/rollout/sessions/` have never been mined; extraction only ever
  reads the live transcript, and the spec's end-of-session flush (D4) does not
  go back for them. codex's answer is a bounded, leased, parallel Phase 1 at
  startup.
- **An LLM retrieval judge, deferred not rejected.** The spec declines waku's
  gate on cost, which is right for waku's shape but not for jcode's: a listwise
  rerank on the existing one-turn-behind prefetch adds no loop latency, and
  jcode's "cadence carry" (re-surface the last judged set without re-running)
  bounds the call rate. jcode treats the *absence* of the judge as a measured
  degradation (`memory_judge_metrics.rs`). Revisit once D14 reports a baseline.

### Deliberate — do NOT "fix"

- **No bare `delete` verb for the consolidator.** A memory can only be removed
  as the `supersedes:` list of a merge. mem0 is evidence for this, not against:
  its v2 manager offers ADD/UPDATE/DELETE/NONE (`configs/prompts.py:176`) and
  its v3 extraction prompt is ADD-only with `linked_memory_ids`.
- **No SQLite job queue for consolidation.** codex needs leases and ownership
  tokens because Phase 1 runs ×8 in parallel across many rollouts. We
  consolidate one project, serially, at most daily. Take the outcome taxonomy
  (`succeeded` / `succeeded_no_output` / `failed`) and the retry backoff; leave
  the queue.
- **Semantic memories do not decay with age.** jcode decays confidence for
  everything; we decay episodes only. Demoting "user prefers tables" for being
  old is how a system forgets a standing instruction. Use is recorded for all
  types, but only episodes' scores are multiplied.


## Memory consolidation — shipped 2026-08-23

Spec `specs/2026-08-23-memory-consolidation.md`, plan
`plans/2026-08-23-memory-consolidation.md`, results
`apps/core/src/memory/bench/README.md`. Six phases, 725 tests passing.

Three findings worth keeping, because each contradicts something the spec said:

- **The free abstention gate does not exist.** Top cosine for on-topic queries
  (0.674–0.932) overlaps irrelevant ones (0.588–0.719); a within-query z-score
  overlaps too. Bi-encoder similarity between short texts has a high,
  corpus-dependent floor. Abstention needs a reader (D15). `bench/probe.ts`
  reproduces the table — run it before proposing any new local floor.
- **BM25 + RRF trades ordering for coverage.** recall@5 and precision@5 up, MRR
  and nDCG down. Right for a block the model reads whole; wrong if retrieval is
  ever used somewhere that only reads the first result.
- **A log-scaled use boost cannot overcome exponential decay.** `1 + 0.1·ln(u+1)`
  tops out near 1.5× against a 4× decay span. Use raises the decay floor instead.

### Found by the smoke test (2026-08-23, real MiniMax turns)

Two bugs that every unit test passed through, plus one limitation:

- **Fixed — the citation tag streamed to the user.** Stripping the *final* text
  is too late: `text_delta` reaches the frontend token by token, so the tag was
  plainly visible in `freecode run` output. `CitationStreamFilter` now holds back
  any trailing text that could still become the marker.
- **Fixed — citations were parsed and then dropped.** They are recorded at the
  *end* of a turn, `UsageStore` debounces 2s, and the timer is `unref`'d, so a
  short-lived process exits first. `injectedCount` had persisted while
  `useCount` had not. Now flushed synchronously on `process.on("exit")`.
- [ ] **Headless runs never complete background memory work.** `freecode run`
      exits before fire-and-forget extraction or consolidation lands. Fine for
      the daemon (the TUI stays alive), but it means scripted runs never
      consolidate. Consider awaiting them on the headless path with a budget.

### Still open

- [ ] **Project key collision** — now the highest-value memory fix.
      `mem-store.ts` keys on `path.basename()`, so `~/work/api` and `~/side/api`
      share a store. Actively wrong for episodes. `store/path-formatter.ts`
      already solves it for sessions; reuse it plus a rename migration.
- [ ] **Wire up LongMemEval-S** (`bench/longmemeval.ts`). The committed corpus
      was written by the same people who wrote the retriever; it catches
      regressions and proves nothing about absolute quality. LongMemEval-S uses
      `all-MiniLM-L6-v2`, the embedder we already run, so agentmemory's published
      numbers are a directly comparable baseline.
- [ ] **Measure the judge with a real model.** Every judge figure so far is from
      `--judge=oracle`, a perfect reader, and is therefore a ceiling.
- [ ] **Watch the judge degradation rate.** It fails closed, so a provider
      outage silently turns memory off. `isDegradation()` marks the cases; if
      they fire often, revisit the direction.
- [ ] **Backfill the rollout archive.** Hundreds of historical session
      directories have never been mined; the end-of-session flush only covers
      live sessions.
- [ ] **`Contradicts` edges are still never produced.** Consolidation emits
      `Supersedes` (the writer-knows case) only.
- [ ] **VectorStore id→index `Map`.** O(n²) full sync matters more now that
      consolidation does pairwise-cosine candidate selection.
