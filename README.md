
<div align="center">

```
                 ██████╗ ██████╗ ███████╗███████╗ ██████╗ ██████╗ ██████╗ ███████╗
                ██╔════╝ ██╔══██╗██╔════╝██╔════╝██╔════╝██╔═══██╗██╔══██╗██╔════╝
                █████╗   ██████╔╝█████╗  █████╗  ██║     ██║   ██║██║  ██║█████╗
                ██╔══╝   ██╔══██╗██╔══╝  ██╔══╝  ██║     ██║   ██║██║  ██║██╔══╝
                ██║      ██║  ██║███████╗███████╗╚██████╗╚██████╔╝██████╔╝███████╗
                ╚═╝      ╚═╝  ╚═╝╚══════╝╚══════╝ ╚═════╝ ╚═════╝ ╚═════╝╚══════╝
```


**Open source CLI tool that drives AI coding assistants via browser automation**

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

</div>

**FreeCode** is a thin-client CLI that drives AI coding assistants (ChatGPT, Claude, Gemini) via browser automation to assist with coding tasks. The architecture uses a two-phase approach: the AI first returns which files it needs, then receives those files with the prompt and returns structured file changes.

## Features

- **TUI + VS Code Extension** — Choose your interface
- **JSON-RPC over stdin/stdout** — Lightweight IPC between frontends and CLI
- **Browser-based AI providers** — Direct integration with ChatGPT, Claude, Gemini
- **Two-phase context collection** — Efficient file retrieval before prompts
- **Diff preview before apply** — Review changes before writing
- **Persistent CLI daemon** — Reuses browser connection across turns

## Quick Start

```bash
# Install dependencies
npm install

# Start the TUI
cd apps/tui && npm run dev
```

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                          TUI                                 │
│              (apps/tui) — pure UI shell                    │
│         Uses pi-tui for terminal rendering                  │
│         IPC client sends/receives JSON-RPC                  │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           │ JSON-RPC (stdin/stdout)
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                          CLI Backend                        │
│              (apps/cli) — ALL intelligence                  │
│   Browser controller, parser, tools, context engine,        │
│   agent loop, file applier                                  │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                      AI Provider (Browser)                   │
│                    ChatGPT / Claude / Gemini                 │
└─────────────────────────────────────────────────────────────┘
```

## Documentation

- [Architecture Overview](docs/superpowers/specs/2026-05-23-architecture.md)
- [Agent Loop Design](docs/superpowers/specs/2026-05-25-agent-loop.md)
- [Implementation Plan](docs/superpowers/plans/2026-05-10-freecode-mvp.md)

## License

MIT