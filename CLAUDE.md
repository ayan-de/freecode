# FreeCode Agent Guide

> How to work on this codebase — architectural principles, patterns, and practices.

## Project Overview

FreeCode is a CLI tool that drives AI coding assistants (ChatGPT, Claude, Gemini) via browser automation to assist with coding tasks. The architecture uses a **thin-client model**: multiple frontends (TUI, VS Code extension) delegate all intelligence to a shared CLI backend via JSON-RPC over stdin/stdout.

The system uses a two-phase approach: the AI first returns which files it needs, then receives those files + prompt and returns structured file changes.

---

## Architecture

**TUI and VSCode are pure presentation layers. All business logic lives in CLI.**

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
│              (apps/core) — ALL intelligence                  │
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

**Key principle:** TUI and VSCode are pure presentation layers. All business logic lives in CLI.

---

## Project Structure

```
freecode/
├── packages/
│   └── shared/                     # Shared types + IPC protocol ONLY
│       └── src/
│           ├── types.ts             # Message, MessagePart, ToolResult,
│           │                         # FileChange, ParsedResponse
│           ├── ipc/
│           │   └── protocol.ts     # JsonRpcRequest/Response, StreamResponse
│           └── index.ts
│
├── apps/
│   ├── cli/                        # ALL intelligence lives here
│   │   └── src/
│   │       ├── server.ts            # JSON-RPC stdin/stdout server
│   │       ├── agent/              # Agent loop + session management
│   │       ├── browser/            # Playwright + CDP + provider adapters
│   │       ├── context/            # File tree + context collection
│   │       ├── parser/             # Response parsing
│   │       ├── tools/              # Tool definitions + execution
│   │       └── applier/            # File diff + write
│   │
│   ├── tui/                        # Pure UI shell — no business logic
│   │   └── src/
│   │       ├── index.ts            # Entry point: mounts TUI, connects IPC
│   │       ├── commands/           # TUI-specific commands (model select)
│   │       ├── ipc/
│   │       │   └── client.ts       # JSON-RPC client to CLI
│   │       └── assets/
│   │
│   └── vscode/                     # Pure UI shell — no business logic
│       └── src/
│           ├── extension.ts        # VS Code extension entry point
│           ├── chat/               # React webview components
│           ├── stores/             # Zustand stores (UI state only)
│           └── ipc/
│               └── client.ts       # JSON-RPC client to CLI
│
└── docs/
    └── superpowers/
        ├── specs/                  # Design specifications
        └── plans/                 # Implementation plans
```

---

## Boundary: What Lives Where

| Concern | CLI | TUI | VSCode |
|---------|-----|-----|--------|
| Browser automation (Playwright/CDP) | ✅ | ❌ | ❌ |
| Provider adapters (ChatGPT, Claude) | ✅ | ❌ | ❌ |
| Agent loop + session management | ✅ | ❌ | ❌ |
| Context collection (file tree) | ✅ | ❌ | ❌ |
| Response parsing | ✅ | ❌ | ❌ |
| Tool execution | ✅ | ❌ | ❌ |
| File diff + writing | ✅ | ❌ | ❌ |
| TUI rendering (pi-tui) | ❌ | ✅ | ❌ |
| VS Code webview | ❌ | ❌ | ✅ |
| IPC client | ❌ | ✅ | ✅ |

---

## IPC Protocol

CLI exposes a JSON-RPC 2.0 interface over stdin/stdout. Both TUI and VSCode use the same protocol.

### Methods

| Method | Params | Returns | Description |
|--------|--------|---------|-------------|
| `tools.list` | — | `ToolListItem[]` | List available tools |
| `tools.call` | `{ name: string, args: Record<string, unknown> }` | `ToolResult` | Execute a tool |
| `session.start` | `{ projectPath: string, provider?: string }` | `{ sessionId: string }` | Start a new session |
| `session.send` | `{ sessionId: string, message: string }` | `StreamResponse` (streaming) | Send a message |
| `session.stop` | `{ sessionId: string }` | `void` | Abort current turn |
| `providers.list` | — | `ProviderInfo[]` | List available AI providers |

### Streaming Response

```typescript
interface StreamResponse {
  type: "text" | "code" | "tool" | "done" | "error";
  content: string;
  toolName?: string;      // when type === "tool"
  toolArgs?: unknown;    // when type === "tool"
  toolResult?: string;   // when type === "tool" (after execution)
}
```

---

## Type Sharing

Core domain types live in `packages/shared/src/types.ts`. No duplicate type definitions in frontends.

```typescript
export interface Message {
  id: string;
  role: "user" | "assistant";
  parts: MessagePart[];
  timestamp: number;
}

export type MessagePart =
  | { type: "text"; content: string }
  | { type: "code"; language: string; content: string }
  | { type: "tool"; tool: { name: string; args: Record<string, unknown> }; result?: string };
```

---

## Architectural Principles

### Core Design Principles

1. **SOLID** — Single responsibility, Open-closed, Liskov substitution, Interface segregation, Dependency inversion
2. **YAGNI** — Only implement what's needed now; avoid speculative generalization
3. **DRY** — Don't repeat yourself; extract shared logic to single sources of truth
4. **Decomposition** — Each file/module does one thing well; avoid bloated files

### Thin Client Principles

1. **Zero business logic in frontends** — TUI and VSCode do only rendering and IPC. No browser automation, no file reading, no parsing.
2. **IPC is the only bridge** — All communication between frontends and CLI goes through JSON-RPC. No shared state.
3. **CLI owns everything** — Browser controller, providers, context engine, parser, tools, agent loop all live in CLI.

---

## Key Design Decisions

### 1. Long-Running CLI Daemon

CLI stays alive between turns, maintaining browser connection and session state. Starting a new browser + logging in per prompt is slow (5-15 seconds). A persistent connection enables sub-second response for subsequent turns.

### 2. Two-Phase Context Collection

Before sending a prompt, CLI first asks the LLM which files it needs, then reads only those files:
1. Send prompt + file tree to LLM → LLM returns list of needed files
2. CLI reads those files
3. Send files + prompt to LLM → LLM returns structured response

### 3. Format-Agnostic Parser

Parser tries multiple strategies (structured, markdown, JSON) in chain until one succeeds. LLMs are inconsistent in output format.

### 4. Diff Preview Before Apply

File changes are shown as a diff to the user for approval before writing. Prevents accidental data loss.

---

## File Naming Conventions

| Type | Convention | Example |
|------|-----------|---------|
| Components | PascalCase | `ChatLayout.tsx`, `CodePart.tsx` |
| Stores | kebab-case | `chat-store.ts` |
| IPC client | camelCase | `ipc/client.ts` |
| Provider adapters | camelCase | `chatgpt.ts` |
| Tool implementations | camelCase | `read.ts`, `write.ts` |
| Parser extractors | camelCase | `structured.ts`, `markdown.ts` |

---

## Adding New Features

### 1. Identify the domain

- **Browser layer** (`apps/core/src/browser/`) — Playwright/CDP, DOM adapters
- **Context layer** (`apps/core/src/context/`) — File tree, context compilation
- **Parser layer** (`apps/core/src/parser/`) — Response parsing (JSON/markdown/tool)
- **Applier layer** (`apps/core/src/applier/`) — File writing, diff generation
- **Tools layer** (`apps/core/src/tools/`) — Tool definitions and execution
- **UI components** (`apps/tui/src/`, `apps/vscode/src/`) — Rendering only

### 2. Check existing patterns

Before adding code, verify:
- Does a similar pattern exist? Follow it.
- Is this functionality needed in more than one place? Extract to shared.
- Does this component do more than one thing? Decompose.

### 3. File limits

If a file exceeds ~150 lines, decompose:
- Extract sub-components
- Move helper functions to utils
- Split store logic into separate files

---

## Key Invariants

1. **Frontends are dumb** — TUI and VSCode only render UI and send/receive IPC. All logic is in CLI.
2. **IPC is the only bridge** — No shared state between frontends and CLI.
3. **Types are centralized** — Core domain types live in `packages/shared`. No duplicate type definitions.
4. **Providers are swappable** — ChatGPT/Claude adapters in `browser/providers/` can be swapped without changing core logic.
5. **Parser is chain-based** — Multiple extractors tried in order until one succeeds.

---

## Deferred Items

- **MCP server integration** — Expose tools via Model Context Protocol
- **Storage layer** — Persistent session history across restarts
- **Claude/Gemini providers** — Additional AI provider adapters
- **Rust TUI** — Higher-fidelity terminal rendering (only if performance demands)

Don't implement these unless explicitly requested.