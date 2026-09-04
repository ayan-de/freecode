# @thisisayande/freecode-core

## 0.29.0

### Minor Changes

- **Harness cost efficiency (spec `2026-09-04-harness-cost-efficiency.md`)**: system prompt compressed −38.5% and the five largest tool descriptions roughly halved under a behavioral eval gate (full `eval:gate` GATE OPEN ×3, judged mean 4.83/5); `read` line-number prefixes now default OFF after winning both A/Bs (`FREECODE_READ_LINE_NUMBERS=1` restores them); full tool output reaches the store before any lossy cap. Shell output compression was built but stays flag-off — it lost its A/B (+10.9% cost from recovery detours).
- **Provider catalogue hardening**: `initProviders` memoized with its rejection no longer dropped, the models.dev fetch got a timeout/retries/override, pricing now sourced from models.dev instead of a 6-entry table, weekly catalogue-drift CI check, and `pnpm build:bun` unbroken along with two traps it was hiding.
- **Agent comparison benchmark (Phase 0)**: `bench:agents` harness pinning every agent to one model/key, an opencode adapter (and the MCP asymmetry it exposed), and a `/benchmark` web page fed by every run.
- **Eval harness**: `eval ab` reports tokens, cost, turns, and repeatedCalls per side; new `expectParallelTools` expectation guards parallel batching; nightly trajectory-suite cron enabled in CI.

### Minor Changes

- Unify provider registration behind a dynamic provider catalogue (generic-provider.ts + sdk-factories.ts replace per-provider deepseek/gemini/minimax/openai/zai adapters), improve token usage mapping (mapUsage), and enhance the cross-platform installer update command.

## 0.27.1

### Patch Changes

- 5b51de0: ## v0.27.1

  A documentation and hardening release on top of `v0.27.0`. The 26 commits since `0.27.0` are mostly docs cleanup — the Mermaid conversion work moved ASCII box-drawings on `/internals/*` into proper flowcharts, and several internals pages were rewritten (subagents, runtime, permissions, bus, sessions, eval reference). Underneath, the agent-loop audit closed its last three known gaps, MCP got an interactive picker and stricter tool-conversion validation, `applyEdit` handles ambiguous matches, sessions got a cleanup pass, and the TUI gained `@mention` autocomplete plus fd-less file search and PowerShell clipboard image support.

  ### Added
  - **MCP command and interactive server picker** (`apps/tui/src/commands/built-in.ts`, `apps/tui/src/components/mcp-picker.ts`). A `/mcp` slash command lists configured servers with status, and the picker supports adding/removing entries without dropping to a config file. Tool-conversion (`apps/core/src/mcp/convert-tool.ts`) now validates input schemas before they reach the orchestrator and refuses the malformed ones earlier.
  - **`@mention` autocomplete and fd-less file search** (`apps/tui/src/utils/at-mention-provider.ts`, `file-search.ts`). The TUI input recognises `@` and offers file-path completions from a worker-pool search that doesn't depend on `fd` being installed — falls back to a hand-rolled directory walker and returns ranked by recency.
  - **PowerShell clipboard image handling** (`apps/tui/src/utils/clipboard.ts`). On Windows, the existing image-paste path now also reads PowerShell's clipboard (`Add-Type` + `System.Windows.Forms.Clipboard`) so an image copied from Snipping Tool lands in the prompt the same way a macOS/Linux paste does.
  - **`gemini-web` provider specification** (`docs/superpowers/specs/2026-08-29-gemini-web-provider.md`). The internal spec behind the gemini-web provider landed in `0.27.0`; this release ships the doc.

  ### Changed
  - **Doc diagrams: ASCII → Mermaid** across `/internals/context`, `/internals/hooks`, `/internals/ipc`, `/internals/compaction`, `/internals/providers`, and `/internals/sessions`. The `/internals/context` "What actually reaches the model" diagram is now a four-band flowchart showing the cache breakpoint explicitly (cached system → dynamic system → frozen `messages[0]` → conversation). A global CSS rule scales Mermaid text 15% across all 8 pages that render diagrams.
  - **`/internals/eval` rewritten to match the gate that shipped** (`apps/docs/app/internals/eval/page.mdx`). The reference page used to describe the pre-`0.27.0` gate (unconfigured judge passes by design, etc.); it now documents the post-`0.27.0` behaviour and points operators at `EVAL.md` and `TRACE.md` at the repo root.
  - **Internals pages rewritten** for `/subagents`, `/runtime`, `/permissions`, `/bus`, `/landing`. Each moved from prose-only to a structured page with diagrams and a "where to look" table at the end.

  ### Fixed
  - **`applyEdit` handles ambiguous matches** (`apps/core/src/tools/edit.ts`). When a unique substring matches in more than one place the tool now reports the ambiguity and the number of matches rather than silently picking the first — the previous behaviour could corrupt files when a substring appeared twice in the same line.
  - **Agent-loop audit close-outs** (`apps/core/src/agent/loop.ts`, `effect/loop-health.ts`, `tools/defs-cache.ts`, `recovery/manager.ts`, `title-generator.ts`):
    - `6668c61` closed 6 known gaps affecting cost and correctness (cache-write accounting, prune-state timing, defs cache invalidation, subagent tool gating, end-session flush ordering, breakdown format drift).
    - `815165f` removed the `title-generator` duplicate and the `recovery/manager` dead paths surfaced by the audit.
    - `e18de29` closed the remaining gaps around the `Stop` hook, `SessionStart` ordering, the tree-cache invalidation trigger, and loop-health heuristic D.
  - **Session cleanup** (`apps/core/src/session/manager.ts`, `store.ts`, `normalize/`). Stale sessions are now pruned on access and the dead normaliser module was removed.
  - **`/internals/sessions` event type counts corrected** to reflect the post-`0.27.0` `function.denied` event.

  ### Docs
  - **Mermaid text scaling** (`apps/docs/app/globals.css`) — 15% bump scoped to `.nextra-content` so it doesn't affect non-doc pages.
  - **Sessions "Three logs, three readers" → "Two logs, two readers"** (`apps/docs/app/internals/sessions/page.mdx`). The third log never existed; the section title was carried over from an earlier design and was misleading.

- Updated dependencies [5b51de0]
  - @thisisayande/freecode-shared@0.4.1

## 0.25.9

### Patch Changes

- `memory_injected` stream event for the auto-injection path. Saved memories surfaced into the prompt with no visible cue — the user had to trust the model's behavior to know whether a recall happened at all. The agent loop now emits `memory_injected` once per user message that gets a hit (not every inner-loop tool-call turn — dedup key is the query text), carrying `{ type, name }` per memory so the UI can name them without re-fetching bodies. Wired into the TUI as `*Recalled N things from memory: …*`.

  While moving the recall off its "skip on same text" fast path, `MemoryGraphService.prepareMemories` was changed to be safe to call every turn instead of every user-text-change. A new per-session `resolved` flag means once a query is "resolved" (hit or confirmed miss), the call is a cheap synchronous stash read with no re-fetch, so the always-call pattern costs nothing on warm turns while still letting a cold-start retrieval whose background fetch lands just after `COLD_BUDGET_MS` times out surface on the very next inner-loop turn — previously that miss was lost until the user typed again.

## 0.25.8

### Patch Changes

- Agent-loop iteration safety valve: runs no longer get cut off mid-task with no output. Three pieces working together:
  - Interactive sessions (server.ts, `run` CLI) now default to `maxIterations: Infinity`, matching Claude Code's headless mode and opencode's `agent.steps` default — `maxTurns` is opt-in for subagents and `-p`-style invocations that pass an explicit cap, not a default on every run. `loop-health` (stuck-pattern detection) and the todo/verify gates are what actually end an interactive run.
  - New `wrapUpReminder()` (apps/core/src/agent/reminders.ts) injects a one-shot `<system-reminder>` into the final turn _before_ a cap trips, telling the model to stop calling tools and hand back a plain-text summary. Mirrors opencode's `MAX_STEPS_PROMPT`.
  - When the cap trips anyway, `AgentLoop` returns the model's last text + a `_Stopped: reached the N-turn iteration safety limit…_` footer instead of the previous bare `"Max iterations reached"` with no content. New `lastResponseText` field on `AgentLoop` keeps that text available across normal and abnormal stops.

  Covered by `apps/core/src/agent/max-iterations.test.ts`: wrap-up reminder shape, exact stop-at-cap (no runaway calls), last-text + footer in the returned content, and that the reminder is injected only on the final turn — not the first.

## 0.6.4

### Fixes

- Fixed `TypeError: H is not a function` (and, depending on the tool schema shape, a crash inside Zod's own `toJSONSchema` internals) on tool calls for `anthropic`, `openai`, `gemini`, `minimax`, `deepseek`, and `zai`. Tool `inputSchema` was passed as a raw JSON Schema object; the AI SDK's `asSchema()` treats an unmarked plain object as ambiguous — it checks for Zod's `"~standard"` marker and otherwise calls the object _as a function_ (`schema()`), which throws for a plain object or can misroute into Zod's converter if the shape coincidentally matches. Fixed by wrapping every tool's `inputSchema` with the AI SDK's own `jsonSchema()` helper (new shared `buildToolsParam` in `providers/utils.ts`, replacing six copies of the same unwrapped construction), which tags the object unambiguously and skips the shape-sniffing entirely. Confirmed fixed against a live MiniMax tool-call failure.

## 0.6.3

### Fixes

- Fixed token usage (and the derived context-window `[used/limit]` display) always reading 0 on completion for every AI-SDK-backed provider (anthropic, openai, gemini, minimax, deepseek, zai). `normalizeAiSdkStream` read `chunk.usage` on the stream's `"finish"` event, but the AI SDK types that event as carrying `totalUsage` — `usage` only exists on the separate per-step `"finish-step"` event. `chunk.usage` was therefore always `undefined`, no usage chunk was ever emitted, and every turn's token/context accounting downstream (`agent/loop.ts` turn totals, the TUI's `↓/↑` and `[used/limit]` display) stayed at 0 regardless of what actually streamed. This was a real regression for MiniMax specifically: its pre-0.6.1 hand-rolled SSE parser read Anthropic's raw usage fields directly and was unaffected; the 0.6.1 rewrite onto the shared AI SDK streaming path exposed the pre-existing bug for it too.

## 0.6.2

### Fixes

- Fixed `AI_InvalidPromptError: system must be a string, SystemModelMessage, or array of SystemModelMessage` — the multi-block system prompt (with cache-control) was built as `{ type: "text", text }` content parts, but the AI SDK's `system` array param requires `{ role: "system", content: string }` message objects. Affected `anthropic`, `minimax`, and `zai` (the three providers sharing this Anthropic-Messages-shaped code path) whenever a cached/multi-block system prompt was sent. Deduplicated the fix into one tested helper (`buildAnthropicSystemParam` in `providers/utils.ts`) used by all three, instead of three copies of the same logic.

## 0.6.1

### Features

- Skills: available skills are now advertised in the system prompt (`renderAvailableSkillsSection`), a `skills.list` IPC method exposes name/description/scope, and `SkillsManager`/`SkillRegistry` learned a `plugin` scope so skills from installed plugins are discovered and prioritized alongside repo/user/system skills.
- Adversarial verifier hardening: the verification subagent's prompt now carries the prior round's findings and an anti-ratchet instruction (don't raise fresh nitpicks once earlier gaps are fixed), a scope-discipline rule (don't fail correct, in-scope work for missing edge cases or extra tests), and a fabrication check (a claimed file change absent from the diff is an automatic fail).
- Recovery: retry backoff now honors a provider's `retry-after` / `retry-after-ms` response header when present (e.g. an exact 429 wait), falling back to the existing exponential/linear/fixed backoff only when the header is absent.
- MiniMax provider rewritten on top of `@ai-sdk/anthropic` with a custom `baseURL` instead of a hand-rolled Anthropic Messages client (~450 → ~155 lines); same approach applied to two new providers:
  - **DeepSeek** (`@ai-sdk/deepseek`)
  - **Z.ai / GLM** (`@ai-sdk/anthropic` pointed at z.ai's Anthropic-compatible endpoint)

## 0.6.0

### Features

- Tree-sitter symbol index: the `lsp` tool gains two on-demand operations for locating code without reading whole files — `workspaceSymbol` (find a symbol by name across the repo, ranked exact → prefix → substring) and `documentSymbol` (list the symbols defined in a file). Backed by `web-tree-sitter` (WASM) with prebuilt grammars for TypeScript/TSX, JavaScript/JSX, and Python — no language server or native build required. Whole-repo symbol lists are cached per project by git HEAD with a short TTL; single-file lookups parse fresh.
- Adopts a "pull" model (inspired by grok-build's codebase graph) over a "push" static repo map (aider-style): symbols are never injected into the prompt, so there is zero standing token cost — the agent pays only when it queries. This lets it locate code precisely instead of grepping blindly or reading full files.
- Long-task robustness for the agent loop (see `docs/long-task-robustness.md`). The loop no longer loses its plan on long tasks or declares success on broken code:
  - **Persistent plan** — the `todowrite` list is re-rendered into the prompt every turn from its store (not from history), so it survives context compaction. Iteration cap raised 100 → 250, and loop-health stops are now two-tier (warn at the threshold, hard-stop only at 2×) so legitimate long work isn't killed.
  - **Completion discipline** — a todo-completion gate forces another turn when the model tries to stop with unfinished todos, a nudge reminds it to keep a plan, and the system prompt gains a verify-before-done / report-honestly contract.
  - **Verification gates** — before finishing a run that changed files, a config-driven gate runs the project's typecheck/build (resolved from `package.json` scripts) and feeds failures back; for non-trivial changes (≥3 files) an independent read-only verifier subagent assigns a PASS/FAIL/PARTIAL verdict the main agent cannot self-assign.
- Pinned todo panel in the TUI: an always-on overlay on the right-middle mirrors the agent's live todo list (in addition to inline chat rendering), and clears on a new prompt.

## 0.5.0

### Minor Changes

- 1ef2dd2: feat: add danger mode with permission bypass for agent operations

  Introduces a new `danger` agent mode that skips permission hooks,
  enabling fully automated execution for trusted workflows. Includes
  mode-specific badge colors and enhanced mode display in TUI.

### Patch Changes

- Updated dependencies [1ef2dd2]
  - @thisisayande/freecode-shared@0.3.0

## 0.4.0

### Features

- New `ls` tool for listing directory contents, registered across the permission/UI tables
- Schema properties now declare types, with input coercion so string-typed provider payloads (e.g. MiniMax) no longer trigger validation reject-loops
- Compaction is wired end to end: LLM-backed summaries with a heuristic fallback, models.dev-sourced context limits, persistence to the session store, and `session.compact` IPC + compaction stream events
- `grep` now enforces a ripgrep timeout and hardens path handling
- Agent mode is threaded through session config and message sending
- `uninstall` CLI command to remove FreeCode and related files

### Bug Fixes

- Memory is stored under the home root and written atomically
- Non-bundled builds fail clearly when they can't locate core
- Improved file-change tracking and model-output truncation in the orchestrator

## 0.3.8

- No changes; version bump to stay in lockstep with the TUI (`@thisisayande/freecode` 0.3.8)

## 0.3.7

### Features

- `freecode run [message..]` — headless single-turn execution. Streams assistant text to stdout and tool activity to stderr so output stays pipeable; supports `--model provider/model`, `--agent <mode>`, `--continue`, `--session <id>`, and reading the message from piped stdin

### Maintenance

- Removed stray startup/progress logs that leaked onto stdout (`[AgentLoop] Sending messages…`, `[ThreadStore] Using JSON file backend`, `[MCP] Initialized …`)

## 0.3.6

- No changes; version bump to stay in lockstep with the TUI (`@thisisayande/freecode` 0.3.6)

## 0.3.5

### Features

- Daily token usage tracking persisted to `~/.freecode/usage.json`; the TUI `/usage` command now shows real data
- `session.resume` support over IPC for resuming a previous session by ID

### Bug Fixes

- Tool-call and tool-result message structures updated for compatibility with AI SDK v6

## 0.3.4

### Bug Fixes

- The compiled binary started the JSON-RPC server twice (the module's self-run guard also matches inside a Bun single-file bundle), so every request executed twice: duplicate sessions, doubled user messages, two model generations per prompt, stray "Thinking..." blocks after the turn completed, and duplicate tool rows. `startServer()` is now idempotent

## 0.3.3

- No changes; version bump to stay in lockstep with the binary (`@thisisayande/freecode` 0.3.3)

## 0.3.2

### Features

- `createCli()` factory: single yargs chain owning all commands, one file per command; frontends inject their own commands
- New `serve` command (headless JSON-RPC backend over stdio), replacing the internal `__core` mode
- CLI is bundle-safe (no disk reads for logo/version) and lazy-loads the backend so `mcp`/`session` stay fast

## 0.3.1

### Bug Fixes

- Strip Windows-illegal characters from formatted session directory names; the drive-letter colon (`C:\…`) previously caused `ENOENT` when creating the sessions directory on Windows

## 0.2.0

### Features

- Add permission bypass logic for `danger` agent mode
- Agent loop skips permission hooks when mode is `danger`
