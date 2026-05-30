# FreeCode Agent Guide

> How to work on this codebase — architectural principles, patterns, and practices.

**IMPORTANT: Architecture Spec Compliance**
This codebase follows `docs/superpowers/specs/2026-05-25-architecture-v3.md`. Before implementing features, read that spec. If implementation deviates from it, the spec takes precedence unless explicitly overridden.

## Architecture Spec Details

The full v3 architecture spec defines these systems that must be properly implemented:

| System | Required Components |
|--------|-------------------|
| **Effect/Layer DI** | `effect/context.ts`, `effect/layers.ts`, `effect/runtime.ts` using Effect framework |
| **Bus (PubSub)** | `bus/index.ts`, `bus/events.ts`, `bus/subscriber.ts`, `bus/global-bus.ts` — SessionDiff, SessionError, MCPToolsChanged, ToolsChanged, SubagentStarted, SubagentCompleted events |
| **Hooks (10 types)** | `hooks/runtime.ts`, `hooks/registry.ts`, `hooks/PreToolUse.ts`, `hooks/PostToolUse.ts`, `hooks/PermissionRequest.ts`, `hooks/PreCompact.ts`, `hooks/PostCompact.ts`, `hooks/SessionStart.ts`, `hooks/UserPromptSubmit.ts`, `hooks/SubagentStart.ts`, `hooks/SubagentStop.ts`, `hooks/Stop.ts` |
| **Skills System** | `skills/manager.ts`, `skills/loader.ts`, `skills/registry.ts`, `skills/injection.ts`, `skills/detection.ts`, `skills/plugin.ts`, `skills/plugin-registry.ts`, `skills/types.ts` |
| **Rollout/Event Sourcing** | `rollout/recorder.ts`, `rollout/types.ts`, `rollout/history.ts`, `rollout/replay.ts` with aggregateID + seq |
| **Thread Store** | `store/thread-store.ts`, `store/sqlite-store.ts`, `store/json-store.ts`, `store/migrations/` |
| **MCP Server** | `mcp/server.ts`, `mcp/client.ts`, `mcp/oauth-provider.ts`, `mcp/transport.ts`, `mcp/convert-tool.ts` |
| **Config** | `config/config.ts`, `config/loader.ts`, `config/defaults.ts` with Zod validation |
| **Errors** | `errors/named-error.ts` with NamedError factory |
| **Project Bootstrap** | `project/bootstrap.ts`, `project/vcs.ts`, `project/conventions.ts` |

**Current known deviations from spec:**
- Bus only has question events, not full SessionDiff/SessionError/etc.
- Hooks only implement PreToolUse/PostToolUse, missing PermissionRequest, SubagentStart, SubagentStop, Stop
- No skills system (only a basic skill tool)
- No rollout/event sourcing
- No thread store
- No MCP server
- Effect/layers.ts is loop health evaluator, not full DI

---

## Project Overview

FreeCode is a CLI tool that drives AI coding assistants (ChatGPT, Claude, Gemini) via browser automation to assist with coding tasks. The architecture uses a **thin-client model**: multiple frontends (TUI, VS Code extension) delegate all intelligence to a shared CLI backend via JSON-RPC over stdin/stdout.

The system uses a two-phase approach: the AI first returns which files it needs, then receives those files + prompt and returns structured file changes.

---

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
│              (apps/core) — ALL intelligence                  │
│   Browser controller, parser, tools, context engine,        │
│   agent loop, file applier                                  │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                     AI Provider (Browser)                    │
│                    ChatGPT / Claude / Gemini                 │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                      VS Code Extension                       │
│              (apps/vscode) — pure UI shell                   │
│         React webview + IPC client to CLI                   │
└─────────────────────────────────────────────────────────────┘
```

**Key principle:** TUI and VSCode are pure presentation layers. All business logic lives in CLI.

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
│   │       │   ├── loop.ts
│   │       │   └── session.ts
│   │       ├── browser/            # Playwright + CDP + provider adapters
│   │       │   ├── controller.ts
│   │       │   ├── providers/
│   │       │   │   ├── index.ts
│   │       │   │   ├── chatgpt.ts
│   │       │   │   └── types.ts
│   │       │   └── types.ts
│   │       ├── context/            # File tree + context collection
│   │       │   ├── collector.ts
│   │       │   └── file-tree.ts
│   │       ├── parser/             # Response parsing
│   │       │   ├── registry.ts
│   │       │   └── extractors/
│   │       │       ├── structured.ts
│   │       │       ├── markdown.ts
│   │       │       └── json.ts
│   │       ├── tools/              # Tool definitions + execution
│   │       │   ├── index.ts
│   │       │   ├── read.ts
│   │       │   ├── write.ts
│   │       │   ├── edit.ts
│   │       │   ├── bash.ts
│   │       │   ├── grep.ts
│   │       │   ├── find.ts
│   │       │   └── glob.ts
│   │       └── applier/            # File diff + write
│   │           ├── index.ts
│   │           ├── differ.ts
│   │           └── writer.ts
│   │
│   ├── tui/                        # Pure UI shell — no business logic
│   │   └── src/
│   │       ├── index.ts            # Entry point: mounts TUI, connects IPC
│   │       ├── commands/           # TUI-specific commands (model select)
│   │       │   ├── index.ts
│   │       │   └── built-in.ts
│   │       ├── ipc/
│   │       │   └── client.ts       # JSON-RPC client to CLI
│   │       └── assets/
│   │           └── logo.ts
│   │
│   └── vscode/                     # Pure UI shell — no business logic
│       └── src/
│           ├── extension.ts        # VS Code extension entry point
│           ├── chat/
│           │   ├── ChatView.tsx    # Main webview panel
│           │   ├── MessageList.tsx
│           │   ├── MessageInput.tsx
│           │   └── parts/          # Message part renderers
│           │       ├── TextPart.tsx
│           │       ├── CodePart.tsx
│           │       └── ToolPart.tsx
│           ├── stores/
│           │   └── chat-store.ts   # UI state only (messages, status)
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
  toolArgs?: unknown;     // when type === "tool"
  toolResult?: string;    // when type === "tool" (after execution)
}
```

---

## Type Sharing

Core domain types live in `packages/shared/src/types.ts`:

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

export interface ToolDef {
  id: string;
  description: string;
  parameters: JsonSchema;
}

export interface ToolResult {
  title: string;
  output: string;
  metadata?: Record<string, unknown>;
}

export interface FileChange {
  path: string;
  action: "create" | "update" | "delete";
  content?: string;
  diff?: string;
}
```

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
# CLAUDE.md

Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.
