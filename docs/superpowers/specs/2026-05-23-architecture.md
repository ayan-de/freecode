# FreeCode — Architecture Specification

**Date:** 2026-05-23 (updated 2026-05-24)
**Status:** Draft
**Supersedes:** `2026-05-08-freecode-design.md`

---

## Overview

FreeCode is a CLI tool that drives AI coding assistants (ChatGPT, Claude, Gemini) via browser automation to assist with coding tasks. It uses a **thin-client architecture**: multiple frontends (TUI, VS Code extension) delegate all intelligence to a shared CLI backend via JSON-RPC over stdin/stdout.

The design is inspired by the agent patterns popularized by Anthropic's Claude Code: an **agent loop** that repeatedly calls tools, a **hook middleware** system for safety and observability, **memory compaction** for long sessions, **context loading** for project conventions, and **sub-agents** for parallel task distribution.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              User                                           │
└──────────────────┬──────────────────────────────────────────────────────────┘
                   │
         ┌─────────┴─────────┐
         │                   │
         ▼                   ▼
┌─────────────────┐   ┌─────────────────┐
│      TUI        │   │    VS Code      │
│  (apps/tui)     │   │  (apps/vscode)  │
│                 │   │                 │
│ Pure UI shell   │   │ Pure UI shell   │
│ - Renders TUI   │   │ - React webview │
│ - IPC to CLI    │   │ - IPC to CLI    │
│ - Zero business │   │ - Zero business │
│   logic         │   │   logic         │
└────────┬────────┘   └────────┬────────┘
         │                     │
         │   JSON-RPC          │
         └────────┬─────────── ┘
                  │ stdin/stdout
                  ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                              CLI Backend (apps/core)                         │
│                                                                             │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐ │
│  │    Agent    │  │   Browser   │  │   Context   │  │      Tools          │ │
│  │    Loop     │  │  Controller │  │   Engine    │  │  read write edit    │ │
│  │             │  │  +providers │  │  (file tree │  │  bash grep find     │ │
│  │  - session  │  │             │  │  + collect) │  │                     │ │
│  │  - LLM orch │  │  Playwright │  │             │  │                     │ │
│  │  - streaming│  │  + CDP      │  │             │  │                     │ │
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────────────┘ │
│                                                                             │
│  ┌─────────────────┐  ┌─────────────────────────────────────────────────┐   │
│  │     Parser      │  │                  Applier                        │   │
│  │  structured     │  │  - Diff generation                              │   │
│  │  markdown       │  │  - File writing                                 │   │
│  │  json           │  │  - Diff preview                                 │   │
│  └─────────────────┘  └─────────────────────────────────────────────────┘   │
│                                                                             │
│                           JSON-RPC Server (stdin/stdout)                    │
└─────────────────────────────────────────────────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         AI Provider (Browser)                               │
│                   ChatGPT / Claude / Gemini                                 │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Agent Loop

The core of FreeCode is an **agent loop**: instead of a single request-response, the agent cycles through decisions until the task is complete.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         Agent Loop (per turn)                               │
│                                                                             │
│   ┌───────┐    ┌─────────┐    ┌──────┐    ┌─────────┐                       │
│   │ Model │───▶│ Decide  │───▶│ Tool │───▶│ Result  │                       │
│   │       │◀───│         │◀───│ Runs │◀───│  comes  │                       │
│   └───────┘    └─────────┘    └──────┘    └─────────┘                       │
│       ▲                                                                     │
│       │                                                                     │
│   ┌───┴───┐                                                                 │
│   │Memory │  ◀── Hooks intercept every tool call (before + after)           │
│   └───────┘                                                                 │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Flow:**

1. Model decides what tool to call (read, write, bash, grep, etc.)
2. **Hooks intercept** — pre-check input, post-check output, can block/modify
3. Tool executes (file system, shell, search)
4. Result flows back through hooks → model
5. Model decides next step or signals completion

### Hooks System

Every tool call passes through hooks before and after execution:

- **Pre-hook:** Inspect/modify input, or **block dangerous commands** before execution
- **Post-hook:** Inspect/modify output, log for observability

```typescript
interface Hook {
  name: string;
  preExecute?: (tool: ToolCall) => ToolCall | null; // null = blocked
  postExecute?: (tool: ToolCall, result: ToolResult) => ToolResult;
}
```

This is how safety (block harmful commands) and observability (log every tool call) are built into the agent.

### Memory System

Tasks can run for hundreds of steps. To avoid hitting context limits:

- **Session memory:** Full conversation history accumulates
- **Compaction:** When history exceeds a threshold, it is summarized and replaced with a compressed version
- **Working memory:** Agent maintains orientation across long tasks

### Context Loading (Before Loop Starts)

Before the agent loop begins, context is loaded from the project:

1. **AGENTS.md** (priority) or **CLAUDE.md** — Project conventions, preferences, folder conventions, test preferences. AGENTS.md is checked first; if present it is used, otherwise CLAUDE.md is loaded as fallback.
2. **Skills** — Reusable instruction sets for specific tasks (code review, documentation, etc.) from `.claude/skills/`

```typescript
interface PreLoopContext {
  projectConventions: string; // from AGENTS.md (priority) or CLAUDE.md
  skills: Skill[]; // from .claude/skills/
}
```

### Sub-Agents

For complex tasks, the main agent can spawn **sub-agents** to handle pieces in parallel:

```
┌─────────────────┐
│ Orchestrator    │
│    Agent        │──▶ Sub-agent: Code review
│                 ├──▶ Sub-agent: Test generation
└────────┬────────┘   └──▶ Sub-agent: Security scan
         │
         ▼
   [Results aggregated]
```

Sub-agents run their own mini-loop focused on one specific task. Spawning is just another tool call (`agent` tool) — the system stays consistent.

---

## Key Design Principle

**TUI and VS Code are pure presentation layers. All business logic lives in CLI.**

This means:

- No browser automation code in TUI or VSCode
- No file reading/writing in TUI or VSCode
- No parsing logic in TUI or VSCode
- No agent loop or session state in TUI or VSCode

Both frontends connect to CLI via JSON-RPC and only render what CLI returns.

---

## Package Structure

```
freecode/
├── packages/
│   └── shared/                          # Shared types + IPC protocol only
│       ├── src/
│       │   ├── types.ts                 # Message, MessagePart, ToolResult,
│       │   │                             # FileChange, SessionConfig
│       │   ├── ipc/
│       │   │   └── protocol.ts          # JsonRpcRequest, JsonRpcResponse,
│       │   │                             # StreamResponse, method signatures
│       │   └── index.ts
│       └── package.json
│
├── apps/
│   ├── cli/                             # ALL intelligence lives here
│   │   └── src/
│   │       ├── server.ts                # JSON-RPC stdin/stdout server
│   │       │
│   │       ├── agent/                   # Agent loop + session management
│   │       │   ├── loop.ts              # Main agent turn loop
│   │       │   ├── session.ts          # Session state + history
│   │       │   └── index.ts
│   │       │
│   │       ├── browser/                 # Playwright + CDP + provider adapters
│   │       │   ├── controller.ts        # PlaywrightBrowserController
│   │       │   ├── providers/
│   │       │   │   ├── index.ts         # Provider registry
│   │       │   │   ├── chatgpt.ts       # ChatGPT adapter
│   │       │   │   ├── claude.ts        # Claude adapter (future)
│   │       │   │   └── types.ts         # PageAdapter, ProviderDefinition
│   │       │   └── types.ts            # BrowserController interface
│   │       │
│   │       ├── context/                 # File tree + context collection
│   │       │   ├── collector.ts         # Context collection engine
│   │       │   ├── file-tree.ts         # File tree generation
│   │       │   └── types.ts
│   │       │
│   │       ├── parser/                  # Response parsing
│   │       │   ├── registry.ts          # Parser registry + chain
│   │       │   ├── extractors/
│   │       │   │   ├── index.ts
│   │       │   │   ├── structured.ts    # FILE: path + code blocks
│   │       │   │   ├── markdown.ts      # Markdown code blocks
│   │       │   │   └── json.ts          # JSON { changes: [] }
│   │       │   └── types.ts
│   │       │
│   │       ├── tools/                   # Tool definitions + execution
│   │       │   ├── index.ts             # Tool registry
│   │       │   ├── types.ts            # ToolDef, ToolContext, ToolResult
│   │       │   ├── read.ts
│   │       │   ├── write.ts
│   │       │   ├── edit.ts
│   │       │   ├── bash.ts
│   │       │   ├── grep.ts
│   │       │   ├── find.ts
│   │       │   └── glob.ts
│   │       │
│   │       └── applier/                 # File diff + write
│   │           ├── index.ts             # Diff + apply logic
│   │           ├── differ.ts            # Generate diffs
│   │           └── writer.ts            # File system operations
│   │
│   ├── tui/                             # Pure UI shell — no business logic
│   │   └── src/
│   │       ├── index.ts                # Entry point: mounts TUI, connects IPC
│   │       ├── commands/               # TUI-specific commands (model select, etc.)
│   │       │   ├── index.ts
│   │       │   └── built-in.ts
│   │       ├── ipc/
│   │       │   └── client.ts           # JSON-RPC client to CLI
│   │       └── assets/
│   │           └── logo.ts
│   │
│   └── vscode/                          # Pure UI shell — no business logic
│       └── src/
│           ├── extension.ts            # VS Code extension entry point
│           ├── chat/
│           │   ├── ChatView.tsx        # Main webview panel
│           │   ├── MessageList.tsx
│           │   ├── MessageInput.tsx
│           │   └── parts/              # Message part renderers
│           │       ├── TextPart.tsx
│           │       ├── CodePart.tsx
│           │       └── ToolPart.tsx
│           ├── stores/
│           │   └── chat-store.ts       # UI state only (messages, status)
│           └── ipc/
│               └── client.ts           # JSON-RPC client to CLI
```

---

## IPC Protocol

CLI exposes a JSON-RPC 2.0 interface over stdin/stdout. Both TUI and VSCode use the same protocol.

### Request/Response

```typescript
interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number | string;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number | string;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}
```

### Methods

| Method           | Params                                            | Returns                      | Description                 |
| ---------------- | ------------------------------------------------- | ---------------------------- | --------------------------- |
| `tools.list`     | —                                                 | `ToolListItem[]`             | List available tools        |
| `tools.call`     | `{ name: string, args: Record<string, unknown> }` | `ToolResult`                 | Execute a tool              |
| `session.start`  | `{ projectPath: string, provider?: string }`      | `{ sessionId: string }`      | Start a new session         |
| `session.send`   | `{ sessionId: string, message: string }`          | `StreamResponse` (streaming) | Send a message              |
| `session.stop`   | `{ sessionId: string }`                           | `void`                       | Abort current turn          |
| `providers.list` | —                                                 | `ProviderInfo[]`             | List available AI providers |

### Streaming Response

```typescript
interface StreamResponse {
  type: "text" | "code" | "tool" | "done" | "error";
  content: string;
  toolName?: string; // when type === "tool"
  toolArgs?: unknown; // when type === "tool"
  toolResult?: string; // when type === "tool" (after execution)
}
```

### Types (from `packages/shared`)

```typescript
// packages/shared/src/types.ts

export interface Message {
  id: string;
  role: "user" | "assistant";
  parts: MessagePart[];
  timestamp: number;
}

export type MessagePart =
  | { type: "text"; content: string }
  | { type: "code"; language: string; content: string }
  | {
      type: "tool";
      tool: { name: string; args: Record<string, unknown> };
      result?: string;
    };

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

export interface ParsedResponse {
  success: boolean;
  response?: {
    summary: string;
    changes: FileChange[];
    raw: string;
    parserUsed: string;
  };
  error?: string;
}
```

---

## Boundary: What Lives Where

| Concern                             | CLI | TUI          | VSCode       |
| ----------------------------------- | --- | ------------ | ------------ |
| Browser automation (Playwright/CDP) | ✅  | ❌           | ❌           |
| Provider adapters (ChatGPT, Claude) | ✅  | ❌           | ❌           |
| Agent loop + session management     | ✅  | ❌           | ❌           |
| Context collection (file tree)      | ✅  | ❌           | ❌           |
| Response parsing                    | ✅  | ❌           | ❌           |
| Tool execution                      | ✅  | ❌           | ❌           |
| File diff + writing                 | ✅  | ❌           | ❌           |
| TUI rendering (pi-tui)              | ❌  | ✅           | ❌           |
| VS Code webview                     | ❌  | ❌           | ✅           |
| UI state (messages, status, theme)  | ❌  | ✅ (Zustand) | ✅ (Zustand) |
| IPC client                          | ❌  | ✅           | ✅           |

---

## Key Design Decisions

### 1. Thin Client Architecture

**Decision:** TUI and VSCode are pure presentation layers. All intelligence is in CLI.

**Rationale:** Avoids code duplication across frontends. Adding a new provider, parser, or tool only requires changing one place.

**Alternatives considered:**

- TUI owns business logic, VSCode delegates to it (couples TUI to backend)
- Each frontend re-implements everything (duplication, maintenance burden)

### 2. Long-Running CLI Daemon

**Decision:** CLI stays alive between turns, maintaining browser connection and session state.

**Rationale:** Starting a new browser + logging in per prompt is slow (5-15 seconds). A persistent connection enables sub-second response for subsequent turns.

**Trade-off:** If CLI crashes, session is lost. Acceptable for MVP.

### 3. Two-Phase Context Collection

**Decision:** Before sending a prompt, CLI first asks the LLM which files it needs, then reads only those files.

**Rationale:** Token-efficient. Only sends relevant context. Allows LLM to reason about the full codebase before diving into specifics.

**Sequence:**

1. Send prompt + file tree to LLM → LLM returns list of needed files
2. CLI reads those files
3. Send files + prompt to LLM → LLM returns structured response

### 4. Format-Agnostic Parser

**Decision:** Parser tries multiple strategies: structured (FILE: path...), markdown, JSON — in chain until one succeeds.

**Rationale:** LLMs are inconsistent in their output format. No single parser handles all cases reliably.

### 5. Diff Preview Before Apply

**Decision:** File changes are shown as a diff to the user for approval before writing.

**Rationale:** Prevents accidental data loss. Builds trust. CLI shows diff, user approves or rejects.

---

## Design Pattern Origins

Every pattern in FreeCode has roots in familiar systems:

| FreeCode Pattern  | Analogous System               | Why It Matters                       |
| ----------------- | ------------------------------ | ------------------------------------ |
| Agent loop        | Worker processing a task queue | Model drives workflow decisions      |
| Tools             | Service interface layer        | Separation of thinking vs doing      |
| Hooks             | Web middleware                 | Safety + observability on every call |
| Memory compaction | Log rotation                   | Handles unbounded session length     |
| Sub-agents        | Worker nodes / map-reduce      | Parallel distributed processing      |
| CLAUDE.md         | Project configuration          | Agent understands your project       |
| Skills            | Reusable scripts / templates   | Pre-packaged behaviors               |

None of this is novel. The innovation is applying these patterns to an agent that drives browser automation for coding tasks.

---

## Deferred Items

- **MCP server integration** — Expose tools via Model Context Protocol
- **Storage layer** — Persistent session history across restarts
- **Rust TUI** — Higher-fidelity terminal rendering (only if performance demands)
- **Sub-agent implementation** — Parallel task distribution for complex tasks
- **Memory compaction** — Automatic summarization of long conversation histories
- **Hook middleware** — Pluggable pre/post tool execution hooks

---

## Success Criteria (Architecture v1)

- [ ] TUI renders correctly using pi-tui, sends/receives JSON-RPC
- [ ] VSCode extension renders correctly in webview, sends/receives JSON-RPC
- [ ] CLI implements all methods in IPC protocol
- [ ] Browser controller connects via CDP to existing Chrome
- [ ] Provider adapters are swappable (ChatGPT, etc.)
- [ ] Parser handles structured, markdown, and JSON formats
- [ ] Tools (read, write, bash, grep, find) execute correctly
- [ ] Context engine generates file tree and collects files
- [ ] Applier shows diff preview before writing
