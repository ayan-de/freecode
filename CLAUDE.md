# FreeCode Agent Guide

> How to work on this codebase — architectural principles, patterns, and practices.

**IMPORTANT: Architecture Spec Compliance**
This codebase follows `docs/superpowers/specs/2026-05-25-architecture-v4.md` (supersedes v3). Before implementing features, read that spec. If implementation deviates from it, the spec takes precedence unless explicitly overridden. Topical specs worth reading before touching a subsystem:

| Area                | Spec                                                    |
| ------------------- | ------------------------------------------------------- |
| Agent loop          | `specs/2026-05-25-agent-loop.md`                        |
| Multi-provider API  | `specs/2026-05-28-multi-provider-api-design.md`         |
| Memory + sessions   | `specs/2026-06-02-memory-session-design.md`             |
| MCP client          | `specs/2026-06-08-mcp-client-design.md`                 |
| Hooks               | `apps/core/src/hooks/hooks-system.md`                   |

## Implemented Subsystems

The v4 architecture systems are implemented and live in `apps/core/src/`:

| System                     | Location                                                                                                          |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| **Effect/Layer DI**        | `effect/context.ts`, `effect/layers.ts`, `effect/runtime.ts`, `effect/loop-health.ts`                            |
| **Providers (API)**        | `providers/` — `anthropic.ts`, `openai.ts`, `gemini.ts`, `minimax.ts`, `registry.ts`, `config.ts`, `streaming.ts`|
| **Agent loop**             | `agent/loop.ts`, `agent/subagent.ts`, `agent/recovery/`, `agent/title-generator.ts`                              |
| **Bus (PubSub)**           | `bus/index.ts`, `bus/bridge.ts` — question + streaming events                                                     |
| **Hooks**                  | `hooks/` — PreToolUse, PostToolUse, PostToolUseFailure, PermissionRequest, PreCompact, PostCompact, SessionStart, UserPromptSubmit, SubagentStart, SubagentStop, Stop, Notification, TurnStart, TurnEnd |
| **Skills System**          | `skills/manager.ts`, `skills/loader.ts`, `skills/registry.ts`, `skills/injection.ts`, `skills/types.ts`          |
| **Rollout/Event Sourcing** | `rollout/recorder.ts`, `rollout/types.ts`, `rollout/history.ts`, `rollout/replay.ts`                              |
| **Thread Store**           | `store/thread-store.ts`, `store/sqlite-store.ts`, `store/json-store.ts`, `store/remote.ts`                        |
| **Sessions**               | `session/manager.ts`, `session/service.ts`, `session/store.ts`, `session/prompt.ts`, `session/normalize/`        |
| **Compaction**             | `compaction/service.ts`, `compaction/selector.ts`, `compaction/summarizer.ts`, `compaction/tokens.ts`            |
| **Memory**                 | `memory/mem-store.ts`, `memory/mem-query.ts`, `memory/mem-prompt.ts`, `memory/mem-types.ts`                       |
| **Permission**             | `permission/` — per-rule allow/ask/deny layer (`rules.ts`, `evaluate.ts`, `mode-policy.ts`, `settings.ts`, `prompt.ts`; spec `2026-07-18-permission-rules.md`) + `profiles.ts` capability profiles (minimal/readonly/standard/elevated/admin, used for subagents). Agent modes (plan/build/review/explore/danger) live in `agent/types.ts`. |
| **MCP Client**             | `mcp/client-registry.ts`, `mcp/service.ts`, `mcp/transport.ts`, `mcp/convert-tool.ts`                            |
| **Context Engine**         | `context/collector.ts`, `context/compiler.ts`, `context/tree-cache.ts`, `context/strategies/`                    |

**Legacy / not wired into the primary path:** `browser/` (Playwright controller + ChatGPT DOM adapter). The default execution path is API providers, not browser automation. Don't extend the browser layer unless explicitly asked.

## Project Overview

FreeCode is a CLI-driven AI coding assistant. The architecture uses a **thin-client model**: multiple frontends (TUI, VS Code, Web, Tauri desktop) delegate all intelligence to a shared CLI backend (`apps/core`) via JSON-RPC over stdin/stdout.

The backend runs a **single agentic tool-use loop**: the model receives the prompt + project context (file tree, git head) and a set of tools, then drives work by emitting tool calls (read/write/edit/bash/grep/glob/etc.) which the loop executes — in parallel batches where safe — feeding results back until the model stops. Providers are reached through the **Vercel AI SDK** (`ai` + `@ai-sdk/anthropic`, `@ai-sdk/google`, `@ai-sdk/openai`) with real streaming, native tool calling, extended thinking, prompt caching, and usage accounting.

---

## Architecture

**TUI, VS Code, and Web are pure presentation layers. All business logic lives in `apps/core`.**

> **TUI Framework**: For pi-tui customization, see [`pi-tui.md`](pi-tui.md).

```
        ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
        │     TUI      │  │   VS Code    │  │     Web      │  │  Desktop     │
        │  (apps/tui)  │  │ (apps/vscode)│  │  (apps/web)  │  │(apps/web-app)│
        │  pi-tui      │  │ React webview│  │  Next.js     │  │ Tauri + Vite │
        └──────┬───────┘  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘
               └─────────────────┴──── JSON-RPC ───┴─────────────────┘
                                       │ (stdin/stdout)
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                          CLI Backend (apps/core) — ALL intelligence           │
│   Effect runtime + layers · Agent loop · Tools · Context engine · Sessions    │
│   Provider registry · MCP client · Hooks · Skills · Memory · Compaction ·     │
│   Rollout (event sourcing) · Thread store · Bus (PubSub) · Permission profiles│
└──────────────────────────────────────┬────────────────────────────────────────┘
                                       │  Vercel AI SDK
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                 AI Providers (API):  Anthropic · OpenAI · Gemini · MiniMax     │
│                       (legacy: browser automation via Playwright)              │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Key principle:** Frontends only render and speak IPC. All business logic lives in `apps/core`.

---

## Project Structure

```
freecode/
├── packages/
│   ├── shared/                     # Shared domain types + IPC protocol ONLY
│   │   └── src/
│   │       ├── types.ts             # Message, MessagePart, ToolDef, ToolResult, Session/Provider types
│   │       ├── ipc/protocol.ts     # JsonRpc*, StreamEvent, StreamResponse, METHODS
│   │       └── index.ts
│   ├── ui/                         # Shared UI primitives
│   ├── eslint-config/
│   └── typescript-config/
│
├── apps/
│   ├── core/                       # CLI backend — ALL intelligence
│   │   └── src/
│   │       ├── server.ts            # JSON-RPC stdin/stdout server
│   │       ├── web-server.ts        # HTTP/WS bridge for the web frontend
│   │       ├── cli.ts + cli/        # yargs entrypoint + subcommands (mcp, session, web)
│   │       ├── agent/              # Agentic tool-use loop, subagents, recovery
│   │       ├── providers/          # API provider adapters + registry (AI SDK)
│   │       ├── browser/            # LEGACY Playwright controller + ChatGPT adapter
│   │       ├── context/            # File tree, context compilation, tree cache
│   │       ├── tools/              # Tool defs + execution (see Tools below)
│   │       ├── session/            # Session manager, service, store, prompt
│   │       ├── store/              # Thread store (sqlite / json / remote)
│   │       ├── rollout/            # Event sourcing: recorder / history / replay
│   │       ├── compaction/         # Context window compaction + summarization
│   │       ├── memory/             # Persistent cross-session memory
│   │       ├── skills/             # Skills manager / loader / registry / injection
│   │       ├── hooks/              # Lifecycle hooks (Pre/PostToolUse, Session, Subagent, …)
│   │       ├── mcp/                # MCP client registry, transport, tool conversion
│   │       ├── permission/         # Permission profiles (plan/build/review/explore/danger)
│   │       ├── bus/                # PubSub event bus + IPC bridge
│   │       ├── effect/             # Effect runtime + layers (DI) + loop-health
│   │       └── utils/
│   │
│   ├── tui/                        # Pure UI shell (pi-tui) — components, state, ipc, themes
│   ├── vscode/                     # Pure UI shell — React webview + extension host + ipc
│   ├── web/                        # Pure UI shell — Next.js
│   ├── web-app/                    # Pure UI shell — Tauri desktop (Vite + React + src-tauri)
│   ├── tui-rs/                     # Experimental Rust TUI
│   └── docs/                       # Documentation site (Next.js)
│
└── docs/
    └── superpowers/
        ├── specs/                  # Design specifications (v4 is current)
        └── plans/                 # Implementation plans
```

### Tools

Built-in tools live in `apps/core/src/tools/` and are registered in `tools/index.ts`:
`read`, `write`, `edit`, `glob`, `grep`, `bash`, `skill`, `agent` (subagent), `question`, `webfetch`, `websearch`, `todowrite`, `lsp`. MCP tools are registered dynamically at runtime via `registerMcpTool`. Each tool is built through `factory.ts` (`buildTool`) with `parameters`/`behavior`/`permissions`/`ui`; execution and batching go through `orchestrator.ts` + `batching.ts`, and rendering through `renderer.ts`.

---

## Boundary: What Lives Where

| Concern                                    | core | TUI | VSCode | Web |
| ------------------------------------------ | ---- | --- | ------ | --- |
| Agent loop + tool execution                | ✅   | ❌  | ❌     | ❌  |
| Provider adapters (Anthropic/OpenAI/…)     | ✅   | ❌  | ❌     | ❌  |
| Sessions, store, rollout, compaction       | ✅   | ❌  | ❌     | ❌  |
| Context collection (file tree)             | ✅   | ❌  | ❌     | ❌  |
| Hooks, skills, memory, permission profiles | ✅   | ❌  | ❌     | ❌  |
| MCP client                                 | ✅   | ❌  | ❌     | ❌  |
| File read / write / diff                   | ✅   | ❌  | ❌     | ❌  |
| Browser automation (legacy Playwright)     | ✅   | ❌  | ❌     | ❌  |
| Rendering (pi-tui / React / Next.js)       | ❌   | ✅  | ✅     | ✅  |
| IPC client                                 | ❌   | ✅  | ✅     | ✅  |

---

## IPC Protocol

`apps/core` exposes a JSON-RPC 2.0 interface over stdin/stdout. All frontends use the same protocol. Method signatures are declared in `packages/shared/src/ipc/protocol.ts` (`METHODS`); handlers live in `apps/core/src/server.ts`.

### Methods

| Group        | Methods                                                                                               |
| ------------ | ----------------------------------------------------------------------------------------------------- |
| **Tools**    | `tools.list`, `tools.call`                                                                             |
| **Session**  | `session.start`, `session.send` (streaming), `session.stop`, `session.list`, `session.resume`, `session.switch`, `session.fork`, `session.archive`, `session.delete`, `session.export`, `session.import`, `session.upload`, `session.download` |
| **Providers**| `providers.list`, `models.list`                                                                        |
| **Config**   | `config.get`                                                                                           |
| **Memory**   | `memory.list`, `memory.get`, `memory.save`, `memory.delete`, `memory.query`                            |
| **Question** | `question.answer`, `question.reject`                                                                   |

### Streaming

`session.send` streams **`StreamEvent`** values (the modern protocol) back to the frontend:

```typescript
type StreamEvent =
  | { type: "tool_start"; toolCallId: string; toolName: string; args: Record<string, unknown> }
  | { type: "tool_output"; toolCallId: string; content: string }
  | { type: "tool_complete"; toolCallId: string; toolName: string; result: string; success: boolean; duration_ms?: number }
  | { type: "thinking"; content: string }        // full reasoning (turn end)
  | { type: "thinking_delta"; delta: string }    // incremental reasoning (streaming)
  | { type: "text"; content: string }            // full assistant text (turn end)
  | { type: "text_delta"; delta: string }        // incremental text (streaming)
  | { type: "done"; content: string }
  | { type: "error"; content: string }
  | { type: "question_asked"; requestId: string; sessionId?: string; questions: QuestionSpec[] };
```

The older `StreamResponse` union still exists in `protocol.ts` for backward compatibility — prefer `StreamEvent` for new work.

---

## Type Sharing

Core domain types live in `packages/shared/src/types.ts` (`Message`, `MessagePart`, `ToolDef`, `ToolResult`, `ToolContext`, `ProviderInfo`, `SessionConfig`, `SessionInfo`). No duplicate type definitions in frontends. Provider-internal types (`ExecuteOptions`, `ExecuteResult`, streaming) live in `apps/core/src/providers/types.ts` and stay in core.

---

## Architectural Principles

### Core Design Principles

1. **SOLID** — Single responsibility, Open-closed, Liskov substitution, Interface segregation, Dependency inversion
2. **YAGNI** — Only implement what's needed now; avoid speculative generalization
3. **DRY** — Don't repeat yourself; extract shared logic to single sources of truth
4. **Decomposition** — Each file/module does one thing well; avoid bloated files

### Thin Client Principles

1. **Zero business logic in frontends** — TUI, VSCode, and Web do only rendering and IPC. No provider calls, no file reading, no tool execution.
2. **IPC is the only bridge** — All frontend↔backend communication goes through JSON-RPC. No shared state.
3. **Core owns everything** — Providers, agent loop, context engine, tools, sessions, hooks, skills, memory all live in `apps/core`.

---

## Key Design Decisions

### 1. Long-Running CLI Daemon

`apps/core` stays alive between turns, maintaining session state, the provider connection, and the project context cache. This enables fast subsequent turns without re-initialization.

### 2. Single Agentic Tool-Use Loop

There is no "ask which files, then send them" pre-pass. The loop collects lightweight project context (name, path, cached file tree, git head — see `context/tree-cache.ts`, invalidated after any mutating tool) and hands the model a tool set. The model then drives the work by emitting tool calls, executed in parallel batches where safe (`tools/batching.ts`, `tools/orchestrator.ts`) and looped back until the model stops.

### 3. Provider Abstraction over the AI SDK

Providers implement a common `AIProvider` interface (`providers/types.ts`) and self-register into the registry (`providers/registry.ts`). Swapping Anthropic ↔ OpenAI ↔ Gemini ↔ MiniMax requires no change to the loop. Streaming, tool calls, extended thinking, and prompt caching are normalized in `providers/streaming.ts`.

### 4. Loop-Health Monitoring

The loop tracks repeated identical tool calls, stagnant turns (no file changes), and oscillation (editing the same file repeatedly) to detect and break stuck patterns (`effect/loop-health.ts`, `updateLoopHealth` in `agent/loop.ts`).

### 5. Permission Profiles & Diff Preview

Tool execution is gated by permission profiles (`permission/profiles.ts`: plan/build/review/explore/danger) and surfaced through the `PermissionRequest` hook. Mutating changes are shown before writing.

### 6. Durable Sessions

Sessions are persisted through the thread store (`store/`, sqlite/json/remote) and rollout event sourcing (`rollout/`), enabling `resume`, `fork`, `export/import`, and `upload/download`. Long contexts are compacted (`compaction/`).

---

## File Naming Conventions

| Type                 | Convention | Example                          |
| -------------------- | ---------- | -------------------------------- |
| React components     | PascalCase | `ChatLayout.tsx`, `CodePart.tsx` |
| Stores               | kebab-case | `chat-store.ts`                  |
| IPC client           | camelCase  | `ipc/client.ts`                  |
| Provider adapters    | camelCase  | `anthropic.ts`, `gemini.ts`      |
| Tool implementations | camelCase  | `read.ts`, `write.ts`            |
| Hook handlers        | PascalCase | `PreToolUse.ts`, `SessionStart.ts` |

---

## Adding New Features

### 1. Identify the domain

- **Providers** (`apps/core/src/providers/`) — AI SDK adapters, model routing
- **Agent** (`apps/core/src/agent/`) — the tool-use loop, subagents, recovery
- **Tools** (`apps/core/src/tools/`) — tool definitions and execution
- **Context** (`apps/core/src/context/`) — file tree, context compilation
- **Session/Store/Rollout** (`apps/core/src/{session,store,rollout}/`) — persistence, lifecycle
- **Hooks / Skills / Memory / MCP** (`apps/core/src/{hooks,skills,memory,mcp}/`) — extensibility
- **UI** (`apps/tui`, `apps/vscode`, `apps/web`, `apps/web-app`) — rendering only

### 2. Check existing patterns

Before adding code, verify:

- Does a similar pattern exist? Follow it. (Tools → copy an existing tool + `factory.ts`; providers → copy an existing adapter + self-register.)
- Is this functionality needed in more than one frontend? Types go in `packages/shared`.
- Does this component do more than one thing? Decompose.

### 3. File limits

If a file exceeds ~150 lines, decompose (extract sub-components, move helpers to utils, split logic). Note `agent/loop.ts` is an intentional exception — the loop is a cohesive state machine.

---

## Key Invariants

1. **Frontends are dumb** — TUI/VSCode/Web only render UI and send/receive IPC. All logic is in `apps/core`.
2. **IPC is the only bridge** — No shared state between frontends and backend.
3. **Types are centralized** — Core domain types live in `packages/shared`. No duplicate definitions.
4. **Providers are swappable** — Adapters in `providers/` implement `AIProvider` and self-register; the loop never hard-codes a provider.
5. **Tools are uniform** — Every tool is built via `factory.ts` and executed through the orchestrator; MCP tools register through the same registry.

---

## Deferred Items

- **MCP server (expose)** — an MCP *client* exists (`mcp/`); serving FreeCode tools *as* an MCP server is not done.
- **Rust TUI** — `apps/tui-rs` is experimental; pi-tui remains the primary TUI.
- **Browser providers beyond ChatGPT** — the browser path is legacy; extend only if explicitly requested.

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
