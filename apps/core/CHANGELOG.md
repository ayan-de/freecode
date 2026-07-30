# @thisisayande/freecode-core

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
