# @thisisayande/freecode-core

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
