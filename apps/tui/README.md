# FreeCode TUI

Terminal UI for the FreeCode AI coding assistant. Ships as a single
self-contained binary (TUI + backend bundled via `bun --compile`).

> **pi-tui Framework**: For TUI framework customization, see [`pi-tui.md`](../../pi-tui.md) in the repo root.

## Install

macOS / Linux:

```sh
curl -fsSL https://freecode.website/install | bash
```

Windows (PowerShell):

```powershell
irm https://freecode.website/install.ps1 | iex
```

Then run `freecode` in any project directory.

- `freecode update` — install the latest release
- `curl -fsSL https://freecode.website/uninstall | bash -s -- --yes` — remove it

## Development

```sh
cd apps/tui
pnpm dev
```

Build the distributable binary locally (requires `bun`):

```sh
pnpm build:bun   # → apps/tui/dist/freecode-bun (self-contained)
```

## Keyboard Shortcuts

### Editor Input

| Key                         | Action                                    |
| --------------------------- | ----------------------------------------- |
| `Enter`                     | Submit message                            |
| `Shift+Enter` / `Alt+Enter` | New line                                  |
| `Tab`                       | Autocomplete (file paths, slash commands) |
| `Ctrl+K`                    | Delete to end of line                     |
| `Ctrl+U`                    | Delete to start of line                   |
| `Ctrl+W` / `Alt+Backspace`  | Delete word backwards                     |
| `Alt+D` / `Alt+Delete`      | Delete word forwards                      |
| `Ctrl+A` / `Ctrl+E`         | Line start/end                            |
| `Ctrl+]`                    | Jump forward to character                 |
| `Ctrl+Alt+]`                | Jump backward to character                |

### Autocomplete

- Type `/` to see slash commands
- Press `Tab` for file path completion
- Works with `~/`, `./`, `../`, and `@` prefix
- `@` prefix filters to attachable files

### Agent Modes

| Key         | Action                                                               |
| ----------- | -------------------------------------------------------------------- |
| `Shift+Tab` | Cycle through agent modes (plan → build → review → explore → danger) |

### Mode Colors

| Mode      | Color   | Description            |
| --------- | ------- | ---------------------- |
| `plan`    | Blue    | Read-only analysis     |
| `build`   | Yellow  | Normal coding          |
| `review`  | Green   | Code review only       |
| `explore` | Magenta | Discovery mode         |
| `danger`  | Red     | Bypass all permissions |
