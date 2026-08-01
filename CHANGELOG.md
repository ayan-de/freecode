# Changelog

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
