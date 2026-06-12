# FreeCode — Architecture Specification v2

**Date:** 2026-05-25
**Status:** Draft
**Supersedes:** `2026-05-23-architecture.md`
**Inspired by:** Anthropic's Claude Code (codex-rs)

---

## Overview

FreeCode is a CLI tool that drives AI coding assistants (ChatGPT, Claude, Gemini) via browser automation to assist with coding tasks. It uses a **thin-client architecture**: multiple frontends (TUI, VS Code extension) delegate all intelligence to a shared CLI backend via JSON-RPC over stdin/stdout.

The design is inspired by the agent patterns popularized by Anthropic's Claude Code: an **agent loop** that repeatedly calls tools, a **hook middleware** system for safety and observability, **memory compaction** for long sessions, **context loading** for project conventions, **skills system** for reusable behaviors, **event sourcing** for auditability, and **sub-agents** for parallel task distribution.

This v2 incorporates lessons from analyzing Claude Code's codebase (codex-rs):

- First-class skills system with implicit detection
- Expanded hook system (10 event types)
- Event sourcing / rollout logging for debugging and replay
- Thread store with persistent session state
- Sub-agent lifecycle management
- Permission profiles for sandboxing
- MCP server integration

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
│  │  - session  │  │             │  │  + collect) │  │  agent skill        │ │
│  │  - LLM orch │  │  Playwright │  │             │  │                     │ │
│  │  - streaming│  │  + CDP      │  │             │  │                     │ │
│  │  - skills   │  │             │  │             │  │                     │ │
│  │  - rollout  │  │             │  │             │  │                     │ │
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────────────┘ │
│                                                                             │
│  ┌─────────────────┐  ┌─────────────────────────────────────────────────┐   │
│  │     Parser      │  │                  Applier                        │   │
│  │  structured     │  │  - Diff generation                              │   │
│  │  markdown       │  │  - File writing                                 │   │
│  │  json           │  │  - Diff preview                                 │   │
│  └─────────────────┘  └─────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌─────────────────┐  ┌─────────────────────┐  ┌─────────────────────────┐  │
│  │     Hooks       │  │   Skills Manager    │  │   Rollout / Event Log   │  │
│  │  10 event types │  │   + skill registry  │  │   JSONL to ~/.freecode  │  │
│  └─────────────────┘  └─────────────────────┘  └─────────────────────────┘  │
│                                                                             │
│  ┌─────────────────────┐  ┌─────────────────────────────────────────────┐   │
│  │   Thread Store      │  │            MCP Server                       │   │
│  │   (session persist) │  │   (expose tools via MCP protocol)           │   │
│  └─────────────────────┘  └─────────────────────────────────────────────┘   │
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
│   │Memory │  ◀── Hooks intercept every step (10 event types)                │
│   └───────┘                                                                 │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Flow:**

1. Model decides what tool to call (read, write, bash, grep, agent, skill, etc.)
2. **Hooks intercept** — pre-check input, post-check output, can block/modify
3. Tool executes (file system, shell, search, sub-agent, etc.)
4. Result flows back through hooks → model
5. Rollout event is written (TurnStarted, FunctionCall, FunctionOutput, etc.)
6. Model decides next step or signals completion
7. Post-turn: run compaction check if history exceeds threshold

---

## Hooks System

Every tool call and session lifecycle event passes through hooks. FreeCode adopts Claude Code's 10 hook event types:

```typescript
const HOOK_EVENT_NAMES = [
  "PreToolUse", // Before tool execution — modify input or block
  "PostToolUse", // After tool execution — modify output, log
  "PermissionRequest", // When tool requires user approval
  "PreCompact", // Before memory compaction — inspect/modify context
  "PostCompact", // After memory compaction — verify result
  "SessionStart", // When session begins — initialize session state
  "UserPromptSubmit", // Before user prompt goes to model
  "SubagentStart", // When a sub-agent is spawned
  "SubagentStop", // When a sub-agent completes
  "Stop", // When agent loop terminates
] as const;

interface Hook {
  name: string;
  event: (typeof HOOK_EVENT_NAMES)[number];
  preExecute?: (context: HookContext) => HookResult | null;
  postExecute?: (context: HookContext, result: unknown) => HookResult;
}
```

**HookResult:**

- `continue` — proceed normally
- `block(reason)` — halt with explanation
- `inject(context)` — add additional context to the flow

### Core Hook Runtimes

```
apps/core/src/hooks/
├── runtime.ts           # runPreToolUseHooks, runPostToolUseHooks, etc.
├── registry.ts          # Hook registration and discovery
├── PermissionRequest    # Approval gates before dangerous operations
├── PreToolUse           # Input validation, modification, blocking
├── PostToolUse          // Output logging, modification
├── PreCompact           // Pre-compaction context inspection
├── PostCompact          // Post-compaction verification
├── SessionStart         // Session initialization
├── UserPromptSubmit     // User input validation
├── SubagentStart        // Sub-agent lifecycle start
├── SubagentStop         // Sub-agent lifecycle end
└── Stop                 // Termination handling
```

---

## Skills System

Skills are reusable instruction sets that extend the agent's capabilities. Inspired by Claude Code's `core-skills` and `skills` crates.

### Skill Structure

```
.freecode/skills/
├── .system/                    # Built-in system skills (installed with FreeCode)
│   ├── commit.skill.md         # Git commit workflow
│   ├── review.skill.md         # Code review
│   ├── test.skill.md           # Test generation
│   └── docs.skill.md           # Documentation generation
│
├── .user/                      # User-defined skills (~/.freecode/skills/)
│   └── custom.skill.md
│
└── .repo/                      # Repository-specific skills (.freecode/skills/ in repo)
    └── myproject.skill.md
```

### Skill Format

```markdown
---
name: commit
description: Generate a well-structured git commit message
scope: user # user | repo | system | admin
trigger: /\b(commit|git commit)\b/i
---

You are a git commit expert. Given the diff output, write a conventional commit message:

1. First line: type(scope): brief description (50 chars max)
2. Body: detailed explanation if needed

Types: feat, fix, docs, style, refactor, test, chore
```

### Skills Manager

```typescript
// apps/core/src/skills/
├── manager.ts         # SkillsManager — load, cache, render skills
├── loader.ts          # Load skills from .system, .user, .repo directories
├── registry.ts        # Skill registry with scope-based visibility
├── injection.ts       # Render skills into prompt context
├── detection.ts       # detectImplicitSkillInvocation(command) — pattern matching
└── types.ts           # Skill, SkillMetadata, SkillPolicy, SkillScope
```

**Skill Scopes:**

- `system` — bundled with FreeCode, always available
- `user` — user-installed in `~/.freecode/skills/`
- `repo` — repository-specific in `.freecode/skills/`
- `admin` — requires admin privileges

**Skill Loading:**

1. On startup, scan all skill directories
2. Cache skill metadata (name, scope, trigger patterns)
3. On session start, load applicable skills based on scope + user config
4. Implicit detection: scan user prompt for trigger regex patterns

---

## Rollout / Event Sourcing

Every session action is written to an append-only JSONL log for debugging, replay, and analytics. Inspired by Claude Code's `rollout.rs` and `message-history`.

```
~/.freecode/
├── rollout/
│   └── sessions/
│       └── {sessionId}/
│           └── events.jsonl      # Per-session event log
│
├── history.jsonl                # Global message history (append-only)
│
├── skills/                      # User skills (~/.freecode/skills/)
└── state/                       # SQLite state (thread metadata, goals)
```

### Event Schema

```typescript
type RolloutEvent =
  | {
      type: "TurnStarted";
      sessionId: string;
      turnId: string;
      timestamp: number;
    }
  | { type: "TurnAborted"; sessionId: string; turnId: string; reason: string }
  | {
      type: "FunctionCall";
      sessionId: string;
      turnId: string;
      tool: string;
      args: Record<string, unknown>;
    }
  | {
      type: "FunctionOutput";
      sessionId: string;
      turnId: string;
      tool: string;
      output: string;
      duration_ms: number;
    }
  | {
      type: "CompactOccurred";
      sessionId: string;
      beforeTokens: number;
      afterTokens: number;
    }
  | {
      type: "SubagentStart";
      sessionId: string;
      subagentId: string;
      task: string;
    }
  | {
      type: "SubagentStop";
      sessionId: string;
      subagentId: string;
      result: string;
    }
  | {
      type: "SkillInvoked";
      sessionId: string;
      skillName: string;
      implicit: boolean;
    }
  | {
      type: "HookTriggered";
      sessionId: string;
      hookName: string;
      event: string;
      blocked: boolean;
    };
```

### Why Event Sourcing

- **Debugging**: Replay exactly what happened in a session
- **Analytics**: Aggregate tool usage, error rates, token consumption
- **Replay**: Reconstruct session state from events
- **Audit**: Full trace of every file modification, tool call, and decision

---

## Thread Store (Session Persistence)

Sessions persist across restarts. Inspired by Claude Code's `thread-store` crate.

```typescript
// apps/core/src/store/
├── thread-store.ts    # ThreadStore interface + LocalThreadStore implementation
├── types.ts          # StoredThread, StoredTurn, StoredTurnItemsView
└── migrations/       # Schema migrations for SQLite
```

### ThreadStore Interface

```typescript
interface ThreadStore {
  createThread(thread: StoredThread): Promise<string>; // returns threadId
  getThread(threadId: string): Promise<StoredThread | null>;
  updateThread(threadId: string, updates: Partial<StoredThread>): Promise<void>;
  archiveThread(threadId: string): Promise<void>;
  listThreads(filter?: ThreadFilter): Promise<StoredThread[]>;

  // Turn operations
  appendTurnItem(
    threadId: string,
    turnId: string,
    item: TurnItem,
  ): Promise<void>;
  getTurnItems(threadId: string, turnId: string): Promise<TurnItem[]>;

  // Search
  searchThreads(query: string): Promise<StoredThread[]>;
}
```

### Storage Format

Sessions stored in `~/.freecode/sessions/{threadId}/`:

- `metadata.json` — thread metadata, createdAt, lastAccessed
- `turns/` — directory of turn JSON files
- `history.jsonl` — full message history

---

## Sub-Agents

Complex tasks spawn focused sub-agents that run their own mini-loop. Inspired by Claude Code's multi-agent tooling.

### Sub-Agent Tool

```typescript
// apps/core/src/tools/agent.ts

interface AgentTool {
  name: "agent";
  description: "Spawn a sub-agent to handle a focused task in parallel";
  parameters: {
    task: string; // Task description for the sub-agent
    scope?: "read" | "write" | "review" | "test"; // Agent type
    contextFiles?: string[]; // Files to make available to sub-agent
  };
}
```

### Sub-Agent Lifecycle

```
┌─────────────────────────────────────────────────────────────┐
│ Main Agent                                                  │
│                                                             │
│  1. Spawn sub-agent via `agent` tool                        │
│     → Hook: SubagentStart(sessionId, subagentId, task)      │
│                                                             │
│  2. Sub-agent runs mini-loop (owns session state)           │
│                                                             │
│  3. Sub-agent completes or is stopped                       │
│     → Hook: SubagentStop(sessionId, subagentId, result)     │
│                                                             │
│  4. Main agent aggregates results                           │
└─────────────────────────────────────────────────────────────┘
```

### Sub-Agent States

- `pending` — spawned but not yet started
- `running` — actively processing
- `waiting_for_input` — blocked on user confirmation
- `completed` — finished successfully
- `failed` — error during execution
- `stopped` — terminated by parent or user

---

## Context Loading (Before Loop Starts)

Before the agent loop begins, context is assembled from multiple sources:

```typescript
interface PreLoopContext {
  projectConventions: string; // from AGENTS.md (priority) or CLAUDE.md
  skills: Skill[]; // from .freecode/skills/ (system + user + repo)
  activeSkills: Skill[]; // skills triggered implicitly by prompt patterns
  recentHistory: string; // recent actions for orientation
  permissionProfile: PermissionProfile; // current sandbox permissions
}
```

**Loading order:**

1. **AGENTS.md** (priority) or **CLAUDE.md** — project conventions, preferences
2. **System skills** — bundled skills from `.system/`
3. **User skills** — from `~/.freecode/skills/`
4. **Repo skills** — from `.freecode/skills/` in project root
5. **Recent history** — last N actions for context continuity
6. **Implicit skill detection** — match prompt against skill trigger patterns

---

## Memory System

Tasks can run for hundreds of steps. To avoid hitting context limits:

- **Session memory:** Full conversation history accumulates per turn
- **Compaction:** When history exceeds threshold (~50k tokens), summarize and replace with compressed version
  - Hook: `PreCompact` — inspect context before compaction
  - Hook: `PostCompact` — verify compaction result
- **Working memory:** Agent maintains orientation via recent history rollup

---

## Tool System

### Built-in Tools

| Tool                 | Description                  |
| -------------------- | ---------------------------- |
| `read`               | Read file contents           |
| `write`              | Write/create files           |
| `edit`               | Apply edits to files         |
| `bash`               | Execute shell commands       |
| `grep`               | Search file contents         |
| `find`               | Find files by name pattern   |
| `glob`               | Glob pattern matching        |
| `agent`              | Spawn a sub-agent            |
| `skill`              | Explicitly invoke a skill    |
| `apply_patch`        | Apply a diff/patch           |
| `request_permission` | Request elevated permissions |
| `request_user_input` | Elicit user input mid-loop   |

### Tool Execution Pipeline

```
Tool Call → Hook: PreToolUse → Approval Check → Sandbox Selection → Execute
                                                                      ↓
Hook: PostToolUse ← Result ← Format Output ← Sandbox Execution
```

### Tool Sandbox Levels

- `minimal` — read-only, no network, no shell
- `standard` — read + write, limited shell
- `elevated` — full file access, unrestricted shell
- `sandboxed` — bubblewrap/landlock/seatbelt isolation

---

## MCP Server Integration

FreeCode can run as an MCP server, exposing its tools to other AI tools and vice versa.

```bash
# Run FreeCode as MCP server (stdio protocol)
freecode mcp-server

# Run FreeCode with external MCP server
freecode mcp --external
```

### MCP Protocol Support

- **Incoming**: Accept tool calls from external MCP clients
- **Outgoing**: Call external MCP servers for additional tools

---

## Permission Profiles

Sandbox permissions are materialized from named profiles. Hooks can escalate/demote based on policy.

```typescript
interface PermissionProfile {
  name: string;
  fileRead: boolean;
  fileWrite: boolean;
  network: boolean;
  shell: boolean;
  subprocess: boolean;
}

const PROFILES = {
  minimal: { fileRead: true, fileWrite: false, network: false, shell: false, subprocess: false },
  standard: { fileRead: true, fileWrite: true, network: false, shell: true, subprocess: false },
  elevated: { fileRead: true, fileWrite: true, network: true, shell: true, subprocess: true },
};
};
```

---

## Key Design Principle

**TUI and VS Code are pure presentation layers. All business logic lives in CLI.**

This means:

- No browser automation code in TUI or VSCode
- No file reading/writing in TUI or VSCode
- No parsing logic in TUI or VSCode
- No agent loop, session state, skills, hooks, or rollout in TUI or VSCode

Both frontends connect to CLI via JSON-RPC and only render what CLI returns.

---

## Package Structure

```
freecode/
├── packages/
│   └── shared/                          # Shared types + IPC protocol only
│       ├── src/
│       │   ├── types.ts                 # Message, MessagePart, ToolResult,
│       │   │                             # FileChange, SessionConfig, RolloutEvent
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
│   │       │   ├── turn.ts              # Per-turn execution
│   │       │   ├── compact.ts           # Memory compaction logic
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
│   │       │   ├── orchestrator.ts     # Tool approval + sandbox + execution
│   │       │   ├── router.ts           # Route tool calls to handlers
│   │       │   ├── read.ts
│   │       │   ├── write.ts
│   │       │   ├── edit.ts
│   │       │   ├── bash.ts
│   │       │   ├── grep.ts
│   │       │   ├── find.ts
│   │       │   ├── glob.ts
│   │       │   ├── agent.ts            # Sub-agent spawning
│   │       │   └── skill.ts            # Skill invocation
│   │       │
│   │       ├── applier/                 # File diff + write
│   │       │   ├── index.ts             # Diff + apply logic
│   │       │   ├── differ.ts            # Generate diffs
│   │       │   └── writer.ts            # File system operations
│   │       │
│   │       ├── hooks/                   # Hook middleware system
│   │       │   ├── runtime.ts           # runPreToolUseHooks, runPostToolUseHooks, etc.
│   │       │   ├── registry.ts          # Hook registration + discovery
│   │       │   ├── PreToolUse.ts
│   │       │   ├── PostToolUse.ts
│   │       │   ├── PermissionRequest.ts
│   │       │   ├── PreCompact.ts
│   │       │   ├── PostCompact.ts
│   │       │   ├── SessionStart.ts
│   │       │   ├── UserPromptSubmit.ts
│   │       │   ├── SubagentStart.ts
│   │       │   ├── SubagentStop.ts
│   │       │   ├── Stop.ts
│   │       │   └── types.ts
│   │       │
│   │       ├── skills/                  # Skills system
│   │       │   ├── manager.ts           # SkillsManager — load, cache, render
│   │       │   ├── loader.ts           # Load skills from filesystem
│   │       │   ├── registry.ts          # Skill registry + scope filtering
│   │       │   ├── injection.ts        # Render skills into prompt context
│   │       │   ├── detection.ts        # detectImplicitSkillInvocation()
│   │       │   └── types.ts            # Skill, SkillMetadata, SkillPolicy
│   │       │
│   │       ├── rollout/                 # Event sourcing / audit log
│   │       │   ├── recorder.ts         # RolloutRecorder — write JSONL events
│   │       │   ├── types.ts            # RolloutEvent types
│   │       │   ├── history.ts          # ~/.freecode/history.jsonl writer
│   │       │   └── replay.ts           # Replay events for debugging
│   │       │
│   │       ├── store/                   # Thread/session persistence
│   │       │   ├── thread-store.ts     # ThreadStore interface + LocalThreadStore
│   │       │   ├── types.ts           # StoredThread, StoredTurn
│   │       │   └── migrations/        # Schema migrations
│   │       │
│   │       └── mcp/                     # MCP server integration
│   │           ├── server.ts           # MCP server implementation
│   │           ├── client.ts           # MCP client for external servers
│   │           └── types.ts
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
│
└── .freecode/                          # User-level FreeCode config (home dir)
    └── skills/                          # User-installed skills (~/.freecode/skills/)
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

| Method              | Params                                            | Returns                      | Description                 |
| ------------------- | ------------------------------------------------- | ---------------------------- | --------------------------- |
| `tools.list`        | —                                                 | `ToolListItem[]`             | List available tools        |
| `tools.call`        | `{ name: string, args: Record<string, unknown> }` | `ToolResult`                 | Execute a tool              |
| `session.start`     | `{ projectPath: string, provider?: string }`      | `{ sessionId: string }`      | Start a new session         |
| `session.send`      | `{ sessionId: string, message: string }`          | `StreamResponse` (streaming) | Send a message              |
| `session.stop`      | `{ sessionId: string }`                           | `void`                       | Abort current turn          |
| `session.resume`    | `{ sessionId: string }`                           | `{ sessionId: string }`      | Resume existing session     |
| `session.fork`      | `{ sessionId: string, point?: string }`           | `{ newSessionId: string }`   | Fork session at point       |
| `session.list`      | `{ filter?: ThreadFilter }`                       | `StoredThread[]`             | List sessions               |
| `providers.list`    | —                                                 | `ProviderInfo[]`             | List available AI providers |
| `skills.list`       | `{ scope?: SkillScope }`                          | `SkillMetadata[]`            | List available skills       |
| `skills.invoke`     | `{ name: string, context?: object }`              | `SkillResult`                | Invoke a skill              |
| `hooks.list`        | —                                                 | `HookDefinition[]`           | List registered hooks       |
| `rollout.getEvents` | `{ sessionId: string }`                           | `RolloutEvent[]`             | Get session events          |

### Streaming Response

```typescript
interface StreamResponse {
  type: "text" | "code" | "tool" | "done" | "error" | "skill" | "subagent";
  content: string;
  toolName?: string; // when type === "tool"
  toolArgs?: unknown; // when type === "tool"
  toolResult?: string; // when type === "tool" (after execution)
  skillName?: string; // when type === "skill"
  subagentId?: string; // when type === "subagent"
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

// v2 new types

export type SkillScope = "system" | "user" | "repo" | "admin";

export interface Skill {
  name: string;
  description: string;
  scope: SkillScope;
  content: string; // Raw skill markdown
  trigger?: RegExp; // Implicit trigger pattern
  parameters?: JsonSchema; // Optional expected parameters
}

export type RolloutEvent =
  | {
      type: "TurnStarted";
      sessionId: string;
      turnId: string;
      timestamp: number;
    }
  | { type: "TurnAborted"; sessionId: string; turnId: string; reason: string }
  | {
      type: "FunctionCall";
      sessionId: string;
      turnId: string;
      tool: string;
      args: Record<string, unknown>;
    }
  | {
      type: "FunctionOutput";
      sessionId: string;
      turnId: string;
      tool: string;
      output: string;
      duration_ms: number;
    }
  | {
      type: "CompactOccurred";
      sessionId: string;
      beforeTokens: number;
      afterTokens: number;
    }
  | {
      type: "SubagentStart";
      sessionId: string;
      subagentId: string;
      task: string;
    }
  | {
      type: "SubagentStop";
      sessionId: string;
      subagentId: string;
      result: string;
    }
  | {
      type: "SkillInvoked";
      sessionId: string;
      skillName: string;
      implicit: boolean;
    }
  | {
      type: "HookTriggered";
      sessionId: string;
      hookName: string;
      event: string;
      blocked: boolean;
    };

export interface StoredThread {
  id: string;
  projectPath: string;
  createdAt: number;
  lastAccessedAt: number;
  provider: string;
  status: "active" | "archived";
  turnCount: number;
  messageCount: number;
}

export type HookEventType =
  | "PreToolUse"
  | "PostToolUse"
  | "PermissionRequest"
  | "PreCompact"
  | "PostCompact"
  | "SessionStart"
  | "UserPromptSubmit"
  | "SubagentStart"
  | "SubagentStop"
  | "Stop";

export interface HookResult {
  action: "continue" | "block" | "inject";
  reason?: string;
  injectContext?: Record<string, unknown>;
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
| Skills loading + injection          | ✅  | ❌           | ❌           |
| Hooks (10 event types)              | ✅  | ❌           | ❌           |
| Rollout event logging               | ✅  | ❌           | ❌           |
| Thread store persistence            | ✅  | ❌           | ❌           |
| MCP server/client                   | ✅  | ❌           | ❌           |
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

**Trade-off:** If CLI crashes, session is lost. **Mitigation:** Thread store persists session; on restart, user can resume.

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

### 6. Event Sourcing for Auditability

**Decision:** Every session action is written to a JSONL rollout log.

**Rationale:** Enables debugging (replay exact sequence), analytics (aggregate metrics), replay (reconstruct state), and audit (full trace of all changes).

### 7. Skills as First-Class Resources

**Decision:** Skills are loaded from a structured directory, cached, and injected into prompts with implicit detection via trigger patterns.

**Rationale:** Makes FreeCode genuinely extensible. Users write `.skill.md` files; FreeCode detects when to invoke them based on prompt content.

---

## Deferred Items (v1 → v2 Status)

These were deferred in v1; v2 now provides the architecture for them:

| Item                     | v1 Status       | v2 Status    | Notes                                     |
| ------------------------ | --------------- | ------------ | ----------------------------------------- |
| MCP server integration   | Deferred        | **Planned**  | Full MCP server/client in architecture    |
| Storage layer            | Deferred        | **Planned**  | ThreadStore with LocalThreadStore impl    |
| Sub-agent implementation | Deferred        | **Planned**  | Sub-agent tool + lifecycle hooks          |
| Memory compaction        | Deferred        | **Planned**  | PreCompact/PostCompact hooks + compact.ts |
| Hook middleware          | Basic (2 hooks) | **Expanded** | 10 hook event types                       |
| Rust TUI                 | Deferred        | Deferred     | Still deferred — only if perf demands     |

---

## Design Pattern Origins

Every pattern in FreeCode v2 has roots in familiar systems:

| FreeCode Pattern    | Analogous System                | Why It Matters                                 |
| ------------------- | ------------------------------- | ---------------------------------------------- |
| Agent loop          | Worker processing a task queue  | Model drives workflow decisions                |
| Tools               | Service interface layer         | Separation of thinking vs doing                |
| Hooks (10 types)    | Web middleware + event sourcing | Safety + observability + lifecycle             |
| Memory compaction   | Log rotation                    | Handles unbounded session length               |
| Sub-agents          | Worker nodes / map-reduce       | Parallel distributed processing                |
| Skills              | Reusable scripts / templates    | Pre-packaged behaviors with implicit detection |
| Rollout events      | Event sourcing / audit log      | Debugging, replay, analytics                   |
| Thread Store        | Persistent queue                | Sessions survive restarts                      |
| MCP integration     | Plugin architecture             | Interoperability with other AI tools           |
| Permission profiles | Capability-based security       | Granular sandbox control                       |

---

## Success Criteria (Architecture v2)

- [ ] Everything from v1 success criteria
- [ ] Skills system loads skills from .system, .user, .repo scopes
- [ ] Implicit skill detection matches prompt against trigger patterns
- [ ] Hooks support all 10 event types
- [ ] PreCompact/PostCompact hooks fire around memory compaction
- [ ] Rollout events written to JSONL on every session action
- [ ] ThreadStore persists sessions to ~/.freecode/sessions/
- [ ] Sub-agent spawning via `agent` tool with lifecycle hooks
- [ ] MCP server mode exposes tools via stdio
- [ ] Session resume works after CLI restart
