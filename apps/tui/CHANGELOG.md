# @thisisayande/freecode

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
