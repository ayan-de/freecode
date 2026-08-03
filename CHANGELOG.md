# Changelog

## v0.15.0

### Added
- Prompt history persistence: previously typed prompts are now saved per-project and recallable with the up-arrow, mirroring shell history.
- `/theme` slash command with a token-based theme system (default / solarized-dark / monokai), applied through a chalk/pi-tui apply layer and persisted to `~/.freecode/config.json` with hot-reload.
- `lastAgentMode` is now persisted in config, so the TUI reopens in the agent mode it was last left in instead of always defaulting to build.

### Changed
- The question flow now renders as a centered `QuestionModal` overlay instead of the old inline question picker, matching the permission-picker's presentation.
- The in-progress status line's `↓` (input token) counter now grows live during multi-tool-call turns instead of sitting flat at the initial estimate until the turn finishes — each tool result bumps it by its own size (~4 chars/token), corrected by the real usage once the turn completes.

### Fixed
- The `ModeLine` no longer flashes the wrong agent mode on startup before config has loaded (`modeLoaded` gate).

## v0.14.0

### Changed
- **MCP tools now respect the permission system.** `toolKind()` classified every `mcp__*` tool as read-only, contradicting the doc comment directly above it, so MCP tools skipped the permission prompt entirely in build mode and were waved through `plan`/`review`/`explore` by `modeEnforcement`. An MCP server is arbitrary third-party code, so they now fail closed: a tool is treated as read-only only when its server declares `readOnlyHint: true` in its annotations, which `convertMcpTool` previously discarded. Read-only tools (search, fetch, list) behave as before; anything unannotated prompts on first use in build mode. The escape hatch is a server-level allow rule — `mcp__linear` covers every tool that server exposes. Read-only claims are cleared when a server disconnects, so a later server reusing a tool name can't inherit the exemption.

### Added
- Uncaught exceptions and unhandled rejections are now handled. Previously Node's default handler painted the stack into the alt screen, which was then wiped on restore — the TUI vanished with no explanation and the spawned core backend was left for the OS to reap. The handler restores the terminal first so the report survives, stops the backend, prints the trace, and points at `freecode --resume <id>` since the session is already persisted.
- The core backend is respawned when it dies, with bounded retries (3, backing off 250ms/1s/3s) so a backend that can't start reports it instead of fork-bombing. A process that stayed up more than a minute refreshes the budget rather than spending one accumulated over a long session. Because core keeps its session map in memory, a respawned backend has never heard of the session still on screen, so the frontend re-resumes it server-side — without reloading messages, which would duplicate the visible history.
- API keys are masked at the prompt. They were typed into a plain input and sat on screen in clear text; the alt screen keeps them out of shell scrollback but not out of screenshots, recordings, screen sharing or `tmux capture-pane`.
- CI on every push and pull request (lint, typecheck, build, test). The only workflow was `release.yml`, which fires on a `v*` tag and goes straight to `bun --compile` — nothing ran tests, types or lint before a release shipped.
- MIT `LICENSE` files. Three published packages declared `"license": "MIT"` with no LICENSE anywhere in the repo.

### Fixed
- Bash tool output was never displayed. `isFileRead` had gained `"bash"`, which suppressed the entire result branch, so every command rendered as a bare `● Run(ls)` header with no output and not even the `(no output)` fallback.
- A core crash left the TUI frozen forever. In-flight JSON-RPC calls were never rejected and there was no request timeout, so callers waited indefinitely with no way back short of quitting. Calls are now rejected on backend death and carry a deadline. `session.send` uses an idle deadline reset by each stream event rather than a flat one, since it settles only when the whole turn is done — a total timeout would kill any turn longer than it.
- The core exit/error handlers wrote through `console.log`/`console.error`, injecting raw text into the alt-screen frame and corrupting the differential renderer that `render-guard.ts` exists to protect.
- Message history grew without bound. `messageStore` was constructed with no options, so its `maxMessages` cap never applied and every message — each holding its component and full tool-result strings — was retained for the life of the process. This is the growth behind long-session degradation.
- MCP tool calls could be silently re-run. `behavior.isDestructive` was hardcoded `false`, and both retry paths (`tools/orchestrator.ts`, `agent/recovery/manager.ts`) read that as "safe to retry" — so a transient failure could re-issue a mutation and create the same issue twice. It now derives from `readOnlyHint`.
- The npm package was 93.1 MB packed / 247.6 MB unpacked across 147 files. npm resolves ignore files from the package directory and `apps/tui` has no `.gitignore`, so nothing was excluded — the tarball carried the compiled `dist/freecode` and `dist/freecode-bun` binaries the GitHub release already distributes, all of `src/`, and leftover Next.js config. A `files` allowlist brings it to 76.1 kB / 266.9 kB across 59 files.
- Test suites are green and actually run. `apps/tui` declared no `lint`/`check-types`/`test` scripts, so turbo skipped it entirely; `session/manager.test.ts` and `session/store.test.ts` imported from `vitest`, which isn't a dependency, so 27 tests had never once executed; and two interruption tests in `runtime.test.ts` slept a fixed 50/200ms hoping the loop had reached the provider, which failed under parallel load.

### Removed
- The 4.7 MB commercial music track bundled in `apps/tui/src/assets/`, redistributed under a license we have no standing to grant over someone else's recording. Nothing was lost: `playSound()` had no callers, and `tsc` never copied the `.mp3` into `dist`, so the feature could only ever have run under `tsx src/`.

## v0.13.0

### Added
- Claude Code tab in `/resume`. The session picker now has two tabs — Freecode and Claude Code — switched with `←` / `→` (or `h` / `l`). Core scans `$CLAUDE_CONFIG_DIR` (defaults to `~/.claude`, matching upstream Claude Code), merges `sessions-index.json` with a jsonl fallback, and returns a `ClaudeSessionMeta[]` for the list. The preview pane renders the full transcript as markdown via the new `session.claudeTranscript` IPC method. The tab is read-only for this iteration — Enter on the Claude Code tab shows a "coming soon" message and the modal stays open; the actual import-and-resume flow is a follow-up.

## v0.9.1

### Fixed
- Bash tool could hang forever on any command that left descendants running (`npm test` / `pnpm test` → test runner → workers). The tool resolved only on the child's `close` event, which fires once every stdio pipe is closed — a surviving grandchild still holds the write end, so `close` never arrived and the turn spun indefinitely. This also made the v0.8.2 timeout-as-failure fix unreachable in practice, since that code ran inside the `close` handler. The shell now starts in its own process group (`detached`) and the timeout signals the whole group, so descendants go down with it; the result also settles shortly after `exit` as a fallback if `close` never fires. Timed-out runs no longer strand orphaned processes.
- Project tree watcher (`context/tree-watcher.ts`) started chokidar with `persistent: true` and nothing ever called `stopWatching`, so the watcher handle kept the event loop alive. Any short-lived process that ran a turn hung instead of exiting — most visibly the core test suite, which passed every assertion and then never terminated. Now `persistent: false`; the server is held open by its stdio anyway and change events still fire.

## v0.9.0

### Added
- Docs command with user command examples

## v0.8.2

### Fixed
- Bash tool could hang indefinitely on commands that blocked reading stdin (interactive prompts, `read`, `git push` over HTTPS, `sudo`, `apt`) — the child got a pipe that no one wrote to, so the configured timeout was the only escape. The child now starts with stdin attached to `/dev/null` and the prompt-blocking env vars (`GIT_TERMINAL_PROMPT=0`, `DEBIAN_FRONTEND=noninteractive`) are set, so such commands exit cleanly instead. The SIGKILL escalation timer is now also cleared on `close`/`error`, and a timeout is reported as `success: false, code: "TIMEOUT_<ms>"` so the loop doesn't conclude the command ran successfully.

## v0.8.1

### Fixed
- Tool calls truncated by the output-token cap (notably MiniMax's previous 4096 default) were stored in session history as a raw JSON string, which providers then rejected as `tool_use.input: Input should be a valid dictionary` — bricking the session on every subsequent request. The streaming normalizer now rejects malformed tool-call inputs with an actionable error instead of letting them into history, and the request-layer conversion sends `{}` for any pre-existing poison in loaded history.
- MiniMax provider default `maxOutputTokens` raised from 4096 to 65536 (the endpoint's own ceiling is 524288 on M3 / 196608 on M2). Larger `write` and `edit` calls no longer cut off mid-JSON.

## v0.8.0

### Added
- Syntax highlighting in `ToolResultMessage` rendering, with extended file-read detection

### Changed
- Consistent duration formatting (`formatDuration`) across `freecode` command, main entry, and message components

## v0.7.1

### Added
- Hooks configuration loader (`hooks/settings.ts`): define hooks in `.freecode/settings.json` without touching source, with Claude Code nested-shape compatibility
- `FREECODE_DEBUG` env var gates debug-level logger output
- Syntax highlighting in TUI diff rendering; mention highlighting in prompt editor

### Changed
- Replaced ad-hoc `console.warn` calls across core with the shared logger for consistent log handling

## v0.7.0

### Added
- Memory Graph Service with vector store, knowledge graph builder, and cascade retrieval
- Memory Graph CLI commands (`memory graph stats|rebuild`)
- Context Engine with tree-cache and collection strategies
- Secret filter for memory embeddings
- Deterministic k-means clustering for memory
- Embedder support (local ONNX/fastembed, optional dependency)

### Fixed
- Improved permission profiles and mode policies
- Enhanced MCP client transport and tool conversion
- Better session management with fork and archive support

### Changed
- Updated provider registry with MiniMax support
- Improved agent loop with loop-health monitoring
- Enhanced rollout/event sourcing with replay capabilities

### Infrastructure
- Effect runtime with Layer DI system
- Updated Vercel AI SDK to latest
- Improved SQLite thread store
