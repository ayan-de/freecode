# @thisisayande/freecode

## 0.3.4

### Bug Fixes

- Large multi-line tool results corrupted the display: they were rendered as a single row with embedded newlines, throwing off the renderer's row accounting. Results now show a collapsed 5-line preview with a "… +N lines" tail
- Tool args containing newlines (e.g. edit's `old_string`) no longer break the tool header row

### Maintenance

- pi-tui upgraded 0.74.0 → 0.80.10: render throttling under streaming load, viewport reset after terminal shrink, full redraw on resize, and a stack-overflow fix for very large outputs

## 0.3.3

### Features

- Message history scrolling (PgUp/PgDn) works in any terminal, not just inside VS Code
- Claude Code–style `❯` prompt prefix on the input line
- `/model`: type-to-search across providers and models (167 providers from models.dev)
- `/model`: green ✓ mark for providers with a configured API key
- `/model`: new "Update API key" entry to replace a saved key
- Dedicated API key input with a visible prompt and Esc to cancel

### Bug Fixes

- Saved API keys could never be changed from the TUI (only by editing `~/.freecode/config.json`)
- Entering an API key no longer hijacks the chat input; an abandoned key prompt could previously swallow the next chat message as an API key
- `/model` no longer leaves a permanent "Use the selector below" system message in chat history

## 0.3.2

### Features

- Core CLI commands (`mcp`, `session`, `web`) now work from the installed binary
- New `freecode serve` command starts the headless JSON-RPC backend (stdio)
- Single yargs command surface: TUI is the default command, `-h` lists everything, unknown commands are rejected

## 0.3.1

### Bug Fixes

- Strip Windows-illegal characters (the drive-letter colon) from session directory names, so sessions can be created on Windows
- CI: let `pnpm/action-setup` read the version from `packageManager`, fixing the release workflow

## 0.3.0

### Features

- Ship as a single self-contained binary (TUI + backend bundled via `bun --compile`)
- One-line installer: `curl -fsSL https://freecode.ayande.xyz/install | bash` (+ PowerShell)
- `freecode update` to fetch the latest release; versioned installs with in-place updates
- GitHub Actions release workflow cross-compiles Linux/macOS/Windows binaries on tag push

## 0.2.0

### Features

- Add `danger` agent mode with permission bypass
- Mode-specific badge colors in TUI
- Enhanced agent mode display with cycling instructions
- Combine agent mode and model display in header
