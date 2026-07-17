# @thisisayande/freecode-core

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
