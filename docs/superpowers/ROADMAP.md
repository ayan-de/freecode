# FreeCode Roadmap: Becoming the World's Best Coding Editor

## Executive Summary

FreeCode already has an **impressive foundation** — it has most of the core systems implemented (agent loop, tools, hooks, memory, MCP, sessions, etc.). However, to become the "world's best coding editor," it needs to close the gap between its current state and its spec, and differentiate itself from existing solutions like Cursor, Claude Code, and Zed.

Below is a comprehensive roadmap covering:

1. **Critical gaps to close** (must-fix)
2. **Differentiation opportunities** (must-build)
3. **User experience improvements** (should-fix)
4. **Ecosystem expansion** (could-add)

---

## Part 1: Critical Gaps (Must-Fix)

These are missing pieces that block FreeCode from being production-ready.

### 1.1 Complete the MCP Integration

**Current state:** MCP client exists but only supports local stdio servers.

**What's missing:**

- Remote MCP server support (HTTP/SSE)
- OAuth authentication for MCP servers
- Auto-discovery of MCP tools at startup
- MCP tool caching and hot-reload

**Impact:** Users can't connect to popular MCP servers like contextcarry, Filesystem, or PostgreSQL.

**What's needed to implement it:**

- Use SSEClientTransport or StreamableHTTPClientTransport from @modelcontextprotocol/sdk instead of StdioClientTransport
- Handle authentication (API keys, OAuth tokens)
- Handle connection lifecycle (reconnecting on failure)
- The init.ts connect logic would need a branch for local vs remote transport

The config schema already supports remote (url field in McpServerSchema), but the actual connection code only handles local stdio.

### 1.2 Implement Observability (Logging + Tracing)

**Current state:** No structured logging system.

**What's missing:**

- Structured logger (`apps/core/src/observability/logger.ts`)
- Span tracing for debugging sessions
- Session replay from rollout events
- Debug mode for developers

**Why it matters:** Without observability, debugging agent failures is painful. This is critical for users troubleshooting AI behavior.

```typescript
// apps/core/src/observability/logger.ts

interface LogEntry {
  timestamp: number
  level: "debug" | "info" | "warn" | "error"
  service: string           // "agent.loop", "hooks", "bus", etc.
  message: string
  spanId?: string
  traceId?: string
  data?: Record<string, unknown>
}

const logger = {
  debug: (service: string, message: string, data?: Record<string, unknown>) => {...},
  info: (service: string, message: string, data?: Record<string, unknown>) => {...},
  warn: (service: string, message: string, data?: Record<string, unknown>) => {...},
  error: (service: string, message: string, data?: Record<string, unknown>) => {...},
}
```

### 1.3 Complete the Effect/Layer Dependency Injection

**Current state:** Partial implementation in `effect/` directory.

**What's missing:**

- Complete Effect runtime integration across all services
- Layer composition for clean service dependencies
- Migration of existing services to use Effect

**Why it matters:** This enables proper testing, modularity, and the sophisticated orchestration patterns described in the spec.

### 1.4 User-Defined Prompt Commands Loader

**Current state:** Built-in commands exist (`/init`, etc.) but user-defined commands aren't supported.

**What's needed:**

- Load from `.freecode/commands/*.md` (project) and `~/.freecode/commands/*.md` (global)
- Front-matter parsing for `description`/`argHint`
- Template substitution (`$ARGUMENTS`)

**Impact:** Users can create custom commands like `/commit`, `/review`, `/test`.

**Reference:** opencode's `cfg.command` pattern in `packages/opencode/src/command/index.ts`.

---

## Part 2: Differentiation Opportunities (Must-Build)

These features should make FreeCode **unique** compared to Cursor, Claude Code, Zed, or other AI editors.

### 2.1 Local-First Memory with Knowledge Graph

**Current state:** Basic memory system exists.

**Differentiator:** Build a **local knowledge graph** that understands your codebase:

- Index functions, classes, imports, exports
- Track relationships between files
- Semantic search over your codebase
- Never send your code to external servers for indexing

**Implementation:**

```typescript
// apps/core/src/memory/graph/
interface KnowledgeGraph {
  addNode(file: string, symbols: Symbol[]): void;
  query(query: string): Promise<SearchResult[]>;
  getRelatedSymbols(symbolId: string): Symbol[];
}
```

The memory graph system includes:

- `embedder.ts` (local ONNX/fastembed, optional dep)
- `vector-store.ts` (packed f32 + content-hash cache)
- `builder.ts` (tag/wikilink/supersede edges)
- `clusters.ts` (deterministic k-means)
- `cascade.ts` (seed top-k → graph walk)
- `secret-filter.ts` (never embed secrets)
- `index.ts` (`MemoryGraphService`: async one-turn-behind injection, keyword fallback)

Sidecar in `<memory>/.graph/`. CLI: `memory graph stats|rebuild`.

### 2.2 Hybrid Local + Remote Model Support

**Current state:** Supports API providers (Anthropic, OpenAI, Gemini, MiniMax).

**Differentiator:** Add support for **local models** (Ollama, llama.cpp) with seamless fallback:

- Users can run CodeGemma, DeepSeek-Coder, or StarCoder locally
- Automatic fallback to cloud when local can't handle request
- Privacy-first: code never leaves machine unless user chooses

**Implementation:**

```typescript
// apps/core/src/providers/ollama.ts
interface OllamaProvider {
  listModels(): Promise<string[]>;
  generate(prompt: string, model: string): Promise<string>;
  embed(text: string): Promise<number[]>;
}
```

### 2.3 Real-Time Collaborative Sessions

**Current state:** Single-user sessions.

**Differentiator:** Enable collaborative AI pairing:

- Share session via WebSocket link
- Multiple humans + AI pair programming
- Cursor position sharing
- Chat sidebar for human-to-human communication

**Implementation approach:**

- Use existing `web-server.ts` for WebSocket connections
- Session state broadcasts to all connected clients
- Conflict resolution for simultaneous edits

### 2.4 Native IDE Integration (Beyond VS Code)

**Current state:** VS Code extension exists.

**Differentiator:** Add first-class integrations for:

- **JetBrains IDEs** (IntelliJ, WebStorm, etc.) — huge developer market
- **Neovim** — terminal power users
- **Emacs** — org-mode + AI combination

**Implementation:**

- JetBrains: Use IntelliJ Platform SDK
- Neovim: Python plugin + JSON-RPC (similar to coc.nvim)
- Emacs: Elisp package

### 2.5 Composable Skills System

**Current state:** Basic skills exist.

**Differentiator:** Build a **skills marketplace**:

- Share skills as gists/repos
- Version-locked skill dependencies
- Skill composition (skills that invoke other skills)
- Auto-install skills from URLs

**Example skill marketplace:**

```bash
freecode skill install github.com/freecode/skills/react
freecode skill install npm:@freecode/skills/testing
```

**Example skill composition:**

```markdown
---
name: full-stack
description: Handle full-stack tasks
trigger: /\b(fullstack|full-stack)\b/i
---

You are a full-stack developer. When a task involves:

- Backend: invoke skill:backend
- Frontend: invoke skill:frontend
- Database: invoke skill:database

Always compose relevant sub-skills for comprehensive coverage.
```

---

## Part 3: User Experience Improvements (Should-Fix)

### 3.1 Terminal UI Polish

The TUI needs work to match modern terminal editors:

- **Syntax highlighting** in file previews
- **Diff view** with side-by-side mode
- **Fuzzy file finder** (Ctrl+P style)
- **Command palette** (Ctrl+Shift+P style)
- **Theme system** with dark/light modes

### 3.2 Edit Tool Improvements

The current `edit` tool uses simple string replacement. Enhance it:

- **Smerge-like three-way merge** for complex conflicts
- **Regex-based edits** with capture groups
- **Edit preview** before applying
- **Undo stack** for reversible edits

### 3.3 Better Error Recovery

Current recovery is minimal. Add:

- **Automatic retry** with exponential backoff for transient failures
- **State snapshots** before risky operations
- **Rollback** to previous working state

### 3.4 Windows Parity

Current spec notes Windows support is missing. Ensure:

- Path handling works with both `/` and `\`
- PowerShell and CMD support
- WSL integration
- File watching on Windows

---

## Part 4: Ecosystem Expansion (Could-Add)

### 4.1 Plugin/Extension System

Allow third-party extensions:

```typescript
// freecode.config.ts
export default {
  plugins: [
    '@freecode/plugin-eslint',
    '@freecode/plugin-prettier',
  ],
}
```

### 4.2 Cloud Sync

- Sync sessions across machines
- Share contexts with team members
- Enterprise deployment options

### 4.3 Telemetry Dashboard

- Usage analytics (opt-in)
- Cost tracking per session
- Model performance comparison

---

## Recommended Priority Order

Given the scope, here's a suggested implementation order:

### Phase 1: Production Readiness (1-2 months)

1. Complete MCP remote server support
2. Implement observability (logging/tracing)
3. User-defined prompt commands
4. Windows support parity
5. Terminal UI polish

### Phase 2: Differentiation (2-4 months)

1. Knowledge graph for local code understanding
2. Local model support (Ollama)
3. JetBrains plugin
4. Neovim plugin
5. Composable skills system

### Phase 3: Scale (4-6 months)

1. Real-time collaboration
2. Cloud sync
3. Plugin marketplace
4. Enterprise features

---

## Key Success Metrics

To measure progress toward "world's best":

| Metric | Target |
|--------|--------|
| **Startup time** | < 500ms to first prompt |
| **Tool execution latency** | < 100ms for read/glob/grep |
| **Memory usage** | < 200MB idle |
| **Context window efficiency** | > 80% token utilization |
| **User satisfaction** | NPS > 50 (vs Cursor ~60) |

---

## Competitive Analysis

| Feature | FreeCode | Cursor | Claude Code | Zed |
|---------|----------|--------|-------------|-----|
| Local models | ❌ | ❌ | ❌ | ❌ |
| Knowledge graph | ❌ | ❌ | ❌ | ❌ |
| MCP support | Partial | ✅ | ✅ | ❌ |
| TUI | ✅ | ❌ | ✅ | ❌ |
| Local-first memory | Partial | ❌ | ❌ | ❌ |
| Collaboration | ❌ | ✅ | ❌ | ✅ |
| JetBrains | ❌ | ❌ | ❌ | ❌ |
| Neovim | ❌ | ❌ | ❌ | ❌ |

**The opportunity:** No single tool has all features. FreeCode can own the **privacy-first, local-first, terminal-centric** niche while adding collaboration later.

---

## Implementation Gap Analysis

### What's in spec but NOT yet implemented:

| Component | Status | Notes |
|-----------|--------|-------|
| **Effect/Layer DI** | Partial | Partial implementation in `effect/` directory |
| **Hook system (10 event types)** | ✅ Complete | Fully implemented in `hooks/` |
| **Bus system** | ✅ Complete | Fully implemented in `bus/` |
| **Skills system** | ✅ Complete | Fully implemented in `skills/` |
| **Rollout/Event sourcing** | ✅ Complete | Fully implemented in `rollout/` |
| **Thread Store** | ✅ Complete | SQLite + JSON in `store/` |
| **Sub-agents** | ✅ Complete | Implemented in `agent/subagent.ts` |
| **MCP client** | Partial | Local only, remote not supported |
| **Provider-specific prompts** | ✅ Complete | In `session/prompt/` |
| **Config validation** | ✅ Complete | Zod schemas in `config/` |
| **Observability** | ❌ Not implemented | No `observability/` directory |
| **Multi-agent orchestration** | Partial | Basic subagents, no complex orchestration |
| **Windows support** | ❌ Not implemented | No `platform/` directory |

---

## Summary

FreeCode has excellent bones. To become the world's best coding editor:

1. **Close the gap** between spec and implementation (MCP, observability, Effect/Layer)
2. **Own the local-first niche** (knowledge graph + local models + privacy)
3. **Win terminal users** (polish TUI + Neovim plugin)
4. **Expand to JetBrains** (huge market opportunity)
5. **Add collaboration** when ready

The most impactful quick wins are:

- **Completing MCP remote support** (unblocks users today)
- **Adding local model support** (differentiator + privacy)
- **Knowledge graph** (true understanding of user's codebase)

---

## Current FreeCode Architecture

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

---

## Implemented Subsystems

| System | Location |
|--------|----------|
| **Effect/Layer DI** | `effect/context.ts`, `effect/layers.ts`, `effect/runtime.ts`, `effect/loop-health.ts` |
| **Providers (API)** | `providers/` — `anthropic.ts`, `openai.ts`, `gemini.ts`, `minimax.ts`, `registry.ts`, `config.ts`, `streaming.ts` |
| **Agent loop** | `agent/loop.ts`, `agent/subagent.ts`, `agent/recovery/`, `agent/title-generator.ts` |
| **Bus (PubSub)** | `bus/index.ts`, `bus/bridge.ts` — question + streaming events |
| **Hooks** | `hooks/` — PreToolUse, PostToolUse, PostToolUseFailure, PermissionRequest, PreCompact, PostCompact, SessionStart, UserPromptSubmit, SubagentStart, SubagentStop, Stop, Notification, TurnStart, TurnEnd |
| **Skills System** | `skills/manager.ts`, `skills/loader.ts`, `skills/registry.ts`, `skills/injection.ts`, `skills/types.ts` |
| **Rollout/Event Sourcing** | `rollout/recorder.ts`, `rollout/types.ts`, `rollout/history.ts`, `rollout/replay.ts` |
| **Thread Store** | `store/thread-store.ts`, `store/sqlite-store.ts`, `store/json-store.ts`, `store/remote.ts` |
| **Sessions** | `session/manager.ts`, `session/service.ts`, `session/store.ts`, `session/prompt.ts`, `session/normalize/` |
| **Compaction** | `compaction/service.ts`, `compaction/selector.ts`, `compaction/summarizer.ts`, `compaction/tokens.ts` |
| **Memory** | `memory/mem-store.ts`, `memory/mem-query.ts`, `memory/mem-prompt.ts`, `memory/mem-types.ts` |
| **Memory Graph** | `memory/graph/` — derived KG over persistent memory |
| **Permission** | `permission/` — per-rule allow/ask/deny layer |
| **MCP Client** | `mcp/client-registry.ts`, `mcp/service.ts`, `mcp/transport.ts`, `mcp/convert-tool.ts` |
| **Context Engine** | `context/collector.ts`, `context/compiler.ts`, `context/tree-cache.ts`, `context/strategies/` |

---

*Document generated: 2026-07-27*
*Based on FreeCode architecture v4 specification*
