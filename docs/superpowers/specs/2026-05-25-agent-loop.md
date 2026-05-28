# FreeCode Agent Loop Architecture

**Date:** 2026-05-25
**Status:** Phase 1 Complete (see Implementation Priority for details)
**Supersedes:** Partial implementation in `apps/core/src/agent/loop.ts`

---

## Design Decisions Summary

| Question | Decision | Reference | Status |
|----------|----------|-----------|--------|
| Why loop? | Complex tasks need multi-step | Claude Code / codex | ✅ Done |
| Loop style | Continuous (Claude Code style) | Cycles until no tool calls | ✅ Done |
| Streaming | Full page parse on each turn | Browser Playwright limitation | Pending |
| Tool execution | Mixed (safe=inproc, risky=sandbox) | Best balance | Pending |
| DI framework | Effect/Layer (like opencode) | Testability + composition | ⚠️ Simplified |
| Hooks | Full 10-type system upfront | Claude Code pattern | ✅ Done |
| Skills | Markdown + plugin (extended) | Auto-discovered via glob | Pending |
| MCP | Client first, server later | Matches codex/claude-code | Pending |
| Sub-agents | Full implementation upfront | codex multi_agent pattern | Pending |
| Persistence | SQLite + JSON upfront | Enables resume | Pending |
| Build scope | Full v3 spec all at once | Complete architecture | ⚠️ Phase 1 only |

---

## Canonical Runtime Contracts

These are the **most important** abstractions. Once shipping begins, changing these becomes painful. Stabilize now.

### Core Types

```typescript
// apps/core/src/session/types.ts

interface ModelTurn {
  id: string
  provider: ProviderID
  reasoning?: string
  content: AssistantContent[]
  toolCalls: ToolCall[]
  stopReason:
    | "tool_use"
    | "completed"
    | "max_tokens"
    | "error"
    | "interrupted"
  usage?: {
    inputTokens?: number
    outputTokens?: number
  }
  raw?: unknown
}

interface ToolCall {
  id: string
  tool: string
  args: unknown
  execution: "sequential" | "parallel-safe"
}

interface ToolResult {
  id: string
  toolCallId: string
  tool: string
  title: string
  stdout?: string
  stderr?: string
  exitCode?: number
  duration_ms?: number
  artifacts?: Artifact[]
  structuredData?: unknown
  truncated?: boolean
  error?: string
}

interface RecoveryPolicy {
  canRecover(error: unknown): boolean
  strategy:
    | "retry"
    | "restart-provider"
    | "restart-browser"
    | "rollback-turn"
    | "abort-session"
  maxAttempts: number
  initialDelay?: number
  backoff?: "linear" | "exponential" | "fixed"
}

interface LoopHealth {
  repeatedTools: number
  stagnantTurns: number
  oscillationScore: number
  repeatedReasoningScore: number
}

interface SessionState {
  status: "idle" | "starting" | "running" | "error" | "stopped"
  sessionId: string
  turnCount: number
  iterationCount: number
  loopHealth: LoopHealth
  pendingToolCalls: ToolCall[]
  activeToolChain?: string[]  // for compaction awareness
}
```

---

## Agent Loop Core Pattern

### Continuous Loop (Claude Code Style)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         FreeCode Agent Loop                                 │
│                                                                             │
│   User Input                                                                │
│       │                                                                     │
│       ▼                                                                     │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │                     CONTINUOUS LOOP                                 │   │
│   │                                                                     │   │
│   │   ┌─────────┐    ┌─────────┐    ┌─────────┐    ┌─────────┐          │   │
│   │   │  Build  │───▶│  Send   │───▶│  Normal │───▶│  Parse  │          │   │
│   │   │ Prompt  │    │ to AI   │    │  ize    │    │ModelTurn│          │   │
│   │   └─────────┘    └─────────┘    └─────────┘    └────┬────┘          │   │
│   │       ▲              │              │                │              │   │
│   │       │              │              │                ▼              │   │
│   │       │              │              │         ┌───────────┐         │   │
│   │       │              │              │         │   Tool    │         │   │
│   │       │              │              │         │ Execution │         │   │
│   │       │              │              │         └─────┬─────┘         │   │
│   │       │              │              │               │               │   │
│   │   ┌───┴──────────────┴──────────────┴──────────────┴───────────┐    │   │
│   │   │              Collect Tool Results & Loop                   │    │   │
│   │   └────────────────────────────────────────────────────────────┘    │   │
│   │                                                                     │   │
│   │   On each iteration:                                                │   │
│   │   - Check LoopHealth thresholds                                     │   │
│   │   - Emit Bus events                                                 │   │
│   │   - Run PostToolUse hooks                                           │   │
│   │                                                                     │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│       │                                                                     │
│       ▼                                                                     │
│   No Tool Calls → Output Final Response                                     │
│                                                                             │
│   POST: Run compaction check (turn-aware), post-sampling hooks              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Architecture: Normalization Layer

```
┌────────────────────────────────────────────────────────────────────────────┐
│                         Architecture Flow                                  │
│                                                                            │
│   ┌───────────────────────────────────────────────────────────────────┐    │
│   │                     Provider (Browser)                            │    │
│   │              Playwright → ChatGPT/Claude/Gemini                   │    │
│   └───────────────────────────┬───────────────────────────────────────┘    │
│                               │                                            │
│                               ▼                                            │
│                    ┌──────────────────────┐                                │
│                    │  Raw Provider Response│                               │
│                    │    (HTML/SSE/etc)    │                                │
│                    └──────────┬───────────┘                                │
│                               │                                            │
│                               ▼                                            │
│   ┌───────────────────────────────────────────────────────────────────┐    │
│   │           ProviderResponseNormalizer (SEPARATE LAYER)             │    │
│   │                                                                   │    │
│   │   session/normalize/                                              │    │
│   │     normalize-claude.ts                                           │    │
│   │     normalize-openai.ts                                           │    │
│   │     normalize-gemini.ts                                           │    │
│   │                                                                   │    │
│   │   Each provider normalizer transforms:                            │    │
│   │     Raw HTML/SSE → canonical ModelTurn                            │    │
│   └───────────────────────────┬───────────────────────────────────────┘    │
│                               │                                            │
│                               ▼                                            │
│   ┌───────────────────────────────────────────────────────────────────┐    │
│   │                    Canonical ModelTurn                            │    │
│   │            (Provider-agnostic internal representation)            │    │
│   └───────────────────────────┬───────────────────────────────────────┘    │
│                               │                                            │
│                               ▼                                            │
│   ┌───────────────────────────────────────────────────────────────────┐    │
│   │                      Parser                                       │    │
│   │         Transforms ModelTurn → ToolCall[]                         │    │
│   │         (No provider-specific logic here)                         │    │
│   └───────────────────────────────────────────────────────────────────┘    │
│                                                                            │
└────────────────────────────────────────────────────────────────────────────┘
```

**Why this separation matters:**

- Providers differ in DOM structure, streaming format, tool syntax
- One internal representation means parser stays simple
- Easy to add new providers by adding normalizer, not changing parser
- Eventually may support browser transport, API transport, local models — normalization is reusable

### Loop Exit Conditions

- Model produces response with **no tool_use blocks** → output and exit
- Max iterations reached (configurable, default 100) → exit to user
- User sends interrupt (Ctrl+C) → preserve history, exit
- Error unrecoverable → exit with error state
- Loop health thresholds exceeded → intervention/warn

---

## Effect/Layer Architecture

### Layer Composition

```typescript
// apps/core/src/effect/layers.ts

import { Context, Effect, Layer } from "effect"

// Service interfaces
interface AgentLoop {
  readonly run: (input: UserInput) => Effect.Effect<LoopResult>
  readonly stop: () => Effect.Effect<void>
  readonly interrupt: () => Effect.Effect<void>
}

interface SessionService {
  readonly getHistory: () => Effect.Effect<Message[]>
  readonly appendMessage: (message: Message) => Effect.Effect<void>
  readonly fork: (point?: string) => Effect.Effect<string>
  readonly compact: (options: CompactionOptions) => Effect.Effect<CompactionResult>
  readonly getState: () => Effect.Effect<SessionState>
}

interface ToolOrchestrator {
  readonly execute: (tool: ToolCall) => Effect.Effect<ToolResult>
  readonly canExecute: (tool: ToolCall) => Effect.Effect<boolean>
  readonly executeBatch: (tools: ToolCall[]) => Effect.Effect<ToolResult[]>
}

interface HookRuntime {
  readonly runPreToolUse: (tool: ToolCall, ctx: HookContext) => Effect.Effect<HookResult>
  readonly runPostToolUse: (tool: ToolCall, result: ToolResult, ctx: HookContext) => Effect.Effect<ToolResult>
  readonly runPreCompact: (context: HistoryContext) => Effect.Effect<HookResult>
  readonly runPostCompact: (context: HistoryContext) => Effect.Effect<void>
  readonly runSessionStart: (session: SessionState) => Effect.Effect<void>
  readonly runUserPromptSubmit: (prompt: string) => Effect.Effect<string>
  readonly runSubagentStart: (agent: AgentDefinition) => Effect.Effect<void>
  readonly runSubagentStop: (agent: AgentDefinition, result: string) => Effect.Effect<void>
  readonly runStop: (reason: string) => Effect.Effect<void>
  // ... other hook types
}

interface RecoveryManager {
  readonly getPolicy: (error: Error, context: ToolContext) => RecoveryPolicy
  readonly executeWithRecovery: (tool: ToolCall, policy: RecoveryPolicy) => Effect.Effect<ToolResult>
  readonly classifyError: (error: Error) => ErrorClass
}

// Live implementations composed into AppLayer
const AppLayer = Layer.provideMerge(
  AgentLoopLive,
  Layer.provideMerge(
    SessionServiceLive,
    Layer.provideMerge(
      ToolOrchestratorLive,
      Layer.provideMerge(
        HookRuntimeLive,
        Layer.provideMerge(
          RecoveryManagerLive,
          BrowserControllerLive
        )
      )
    )
  )
)
```

---

## Tool Execution Pipeline

### Tool Categories

| Category | Tools | Execution |
|----------|-------|-----------|
| **Sequential** | edit, write, bash, agent | One at a time, in order |
| **Parallel-safe** | read, grep, glob, find | Batch concurrently |
| **Agent (spawn)** | agent | New session fork |
| **Skills** | skill | Render + invoke |
| **MCP (external)** | mcp.* | Via MCP client |

### Execution Mode

```typescript
type ExecutionMode = "sequential" | "parallel-safe"

// Sequential: tools run one after another
// grep → read → edit → sequential (chain)
// edit file A, then edit file B → sequential (explicit order)

// Parallel-safe: independent tools run concurrently
// read A, read B, read C → parallel (no dependencies)
// grep A, grep B, grep C → parallel (independent searches)

interface ToolCall {
  id: string
  tool: string
  args: unknown
  execution: ExecutionMode
}
```

**Runtime batching:** When multiple parallel-safe tools are queued, batch them into a single concurrent execution. This gives huge speed gains without DAG complexity.

### Pre/Post Hook Flow

```
ToolCall
    │
    ▼
┌─────────────────────┐
│  PreToolUse Hooks   │ ◀── Can block, inject context
└──────────┬──────────┘
           │
    ┌──────▼──────┐
    │Permission   │ ◀── Check profile, ask user if needed
    │   Check     │
    └──────┬──────┘
           │
    ┌──────▼──────┐
    │   Sandbox   │ ◀── bubblewrap for risky, direct for safe
    │  Selection  │
    └──────┬──────┘
           │
    ┌──────▼──────┐
    │    Execute  │
    └──────┬──────┘
           │
    ┌──────▼──────┐
    │ PostToolUse │ ◀── Can modify result, log, inject
    │    Hooks    │
    └──────┬──────┘
           │
           ▼
      ToolResult
```

---

## 10 Hook Event Types

```typescript
const HOOK_EVENT_NAMES = [
  "PreToolUse",       // Before tool execution — modify input or block
  "PostToolUse",      // After tool execution — modify output, log
  "PermissionRequest", // When tool requires user approval
  "PreCompact",       // Before memory compaction — inspect/modify context
  "PostCompact",      // After memory compaction — verify result
  "SessionStart",     // When session begins — initialize session state
  "UserPromptSubmit",  // Before user prompt goes to model
  "SubagentStart",    // When a sub-agent is spawned
  "SubagentStop",     // When a sub-agent completes
  "Stop",             // When agent loop terminates
] as const;

interface HookResult {
  action: "continue" | "block" | "inject";
  reason?: string;
  injectContext?: Record<string, unknown>;
}
```

---

## Infinite Loop Detection

### Multiple Heuristics Simultaneously

Single-threshold systems fail badly. Use composite scoring.

### Heuristics

```typescript
interface LoopHeuristics {
  // A. Repeated identical tool call
  // same tool + same args 3x within 10 turns → hard stop
  repeatedIdenticalThreshold: number  // default: 3

  // B. No state change
  // 5 consecutive turns with no file changes, no new tool results → warning
  stagnantTurnsThreshold: number  // default: 5

  // C. Oscillation detection
  // edit file A, revert file A, edit file A, revert file A → block
  // Track diff fingerprints, detect back-and-forth
  oscillationScoreThreshold: number  // default: 4

  // D. Repeated reasoning similarity
  // assistant reasoning similarity > 90% for N turns → likely stuck
  reasoningSimilarityThreshold: number  // default: 0.9
  reasoningSimilarityTurns: number     // default: 3

  // Overall limits
  totalIterationLimit: number  // hard cap, default: 100
}

interface LoopHealth {
  repeatedTools: number
  stagnantTurns: number
  oscillationScore: number
  repeatedReasoningScore: number

  // Computed
  isHealthy: boolean
  shouldWarn: boolean
  shouldStop: boolean
}
```

### Runtime Behavior

```typescript
const evaluateLoopHealth = (health: LoopHealth, config: LoopHeuristics): LoopAction => {
  if (health.repeatedTools >= config.repeatedIdenticalThreshold) {
    return { action: "stop", reason: "repeated_identical_tool" }
  }
  if (health.stagnantTurns >= config.stagnantTurnsThreshold) {
    return { action: "warn", reason: "no_progress" }
  }
  if (health.oscillationScore >= config.oscillationScoreThreshold) {
    return { action: "stop", reason: "oscillation_detected" }
  }
  if (health.iterationCount >= config.totalIterationLimit) {
    return { action: "stop", reason: "max_iterations_reached" }
  }
  return { action: "continue" }
}

// Warn: notify user, ask to continue
// Stop: halt loop, preserve history
// Continue: proceed normally
type LoopAction = { action: "continue" } | { action: "warn"; reason: string } | { action: "stop"; reason: string }
```

---

## Error Recovery

### RecoveryPolicy + Effect Retry

Use Effect underneath, expose runtime-level semantic policy.

```typescript
interface RecoveryPolicy {
  canRecover(error: unknown): boolean
  strategy:
    | "retry"           // Effect.retry with backoff
    | "restart-provider"  // Reinitialize provider
    | "restart-browser"    // Reconnect Playwright
    | "rollback-turn"      // Restore turn state
    | "abort-session"      // Fatal, end session
  maxAttempts: number
  initialDelay?: number
  backoff?: "linear" | "exponential" | "fixed"
  fallbackTool?: string
}

type ErrorClass = "recoverable" | "fatal"

const ERROR_POLICIES: Record<string, RecoveryPolicy> = {
  // Recoverable
  TransientMCPTimeout: { canRecover: isTransient, strategy: "retry", maxAttempts: 3, backoff: "exponential" },
  PlaywrightDisconnect: { canRecover: always, strategy: "restart-browser", maxAttempts: 2 },
  HTTP429: { canRecover: is429, strategy: "retry", maxAttempts: 5, backoff: "exponential", initialDelay: 5000 },
  MalformedStreamingChunk: { canRecover: always, strategy: "retry", maxAttempts: 3 },
  ProviderTimeout: { canRecover: always, strategy: "retry", maxAttempts: 3, backoff: "exponential" },

  // Fatal
  PermissionDenied: { canRecover: never, strategy: "abort-session" },
  CorruptedSessionState: { canRecover: never, strategy: "abort-session" },
  InvalidToolSchema: { canRecover: never, strategy: "abort-session" },
  RepeatedParserFailures: { canRecover: never, strategy: "abort-session" },
}

const executeWithRecovery = (
  tool: ToolCall,
  policy: RecoveryPolicy
): Effect.Effect<ToolResult> =>
  Effect.retry({
    schedule: {
      strategy: policy.backoff ?? "exponential",
      initialDelay: policy.initialDelay ?? 1000,
      maxDelay: 30000,
      attempts: policy.maxAttempts,
    },
    while: (error) => policy.canRecover(error)
  },
  runTool(tool)
)
```

### Execution with Recovery

```typescript
const executeToolSafely = (tool: ToolCall): Effect.Effect<ToolResult> =>
  Effect.gen(function* () {
    const recovery = yield* RecoveryManager
    const error = yield* Effect.attempt(() => classifyError(tool))

    const policy = recovery.getPolicy(error, tool.context)

    if (!policy.canRecover(error)) {
      if (policy.strategy === "abort-session") {
        return yield* Effect.fail(error)
      }
      // Other fatal strategies handled same way
    }

    if (policy.strategy === "retry") {
      return yield* recovery.executeWithRecovery(tool, policy)
    }

    if (policy.strategy === "restart-browser") {
      yield* BrowserController.reconnect()
      return yield* recovery.executeWithRecovery(tool, policy)
    }

    // ... other strategies
  })
```

---

## Session Management

### Session State Machine

```
┌─────────────┐
│  Idle       │ ◀── No active session
└──────┬──────┘
       │ session.start()
       ▼
┌─────────────┐
│  Starting   │ ◀── Bootstrap, load config, init tools
└──────┬──────┘
       │
       ▼
┌─────────────┐
│  Running    │ ◀── Agent loop active
│             │     - can be interrupted
│             │     - can fork sub-agents
│             │     - tracks LoopHealth
└──────┬──────┘
       │
  ┌────┴────┐
  │         │
  ▼         ▼
┌────────┐ ┌────────┐
│Error   │ │Stopped │
└────────┘ └────────┘
```

### Session State

```typescript
interface SessionState {
  status: "idle" | "starting" | "running" | "error" | "stopped"
  sessionId: string
  turnCount: number
  iterationCount: number
  loopHealth: LoopHealth
  pendingToolCalls: ToolCall[]
  activeToolChain?: string[]  // for compaction awareness
}
```

### Session Fork (Sub-agents)

```typescript
interface ForkResult {
  newSessionId: string
  turnCount: number
  messageCount: number
}

// Sub-agent sessions are independent but linked to parent
session.fork({ sessionId, point: "current" })
session.fork({ sessionId, point: turnId })
```

---

## Sub-Agent Types

| Agent | Mode | Permission | Max Turns | Purpose |
|-------|------|------------|-----------|---------|
| explore | subagent | readonly | 20 | Explore codebase, gather info |
| scout | subagent | minimal | 10 | Quick reconnaissance |
| review | subagent | readonly | - | Code review |
| test | subagent | standard | - | Test generation |
| build | primary | elevated | - | Execute builds |
| plan | primary | minimal | - | Create plans |
| general | primary | standard | - | General assistance |
| compaction | subagent | minimal | 5 | Memory summarization |

### Scheduler

```typescript
interface SchedulerConfig {
  maxConcurrency: number      // max parallel sub-agents
  cancellationPropagation: boolean  // parent stops → children stop
  memorySharing: "none" | "readonly" | "full"
  tokenBudgetPerAgent: number
}
```

---

## Skills + Plugin System

### Auto-Discovery

```typescript
const searchPaths = [
  { pattern: "**/.freecode/skills/**/*.skill.md", scope: "repo" },
  { pattern: "~/.freecode/skills/**/*.skill.md", scope: "user" },
  { pattern: "{installDir}/.system/skills/**/*.skill.md", scope: "system" },
]
```

### Skill Format

```markdown
---
name: commit
description: Generate well-structured git commit
scope: user
trigger: /\b(commit|git commit)\b/i
version: 1.0.0
---

You are a git commit expert...
```

### Plugin Format

```json
{
  "name": "my-plugin",
  "version": "1.0.0",
  "tools": [{ "id": "my-tool", ... }],
  "hooks": { "PreToolUse": "./dist/hooks.js" },
  "mcp": { "command": "node", "args": ["./dist/mcp.js"] }
}
```

---

## MCP Client Integration

### Priority: MCP Client First

FreeCode calls external MCP servers to extend tool set:

```
┌─────────────────────────────────────────┐
│           FreeCode CLI                  │
│                                         │
│  ┌─────────────────────────────────┐    │
│  │        Tool Registry            │    │
│  │  - Built-in (read, write...)    │    │
│  │  - MCP tools (via client)       │    │
│  │  - Plugin tools                 │    │
│  └─────────────────────────────────┘    │
│                  ▲                      │
│                  │                      │
│  ┌───────────────┴─────────────────┐    │
│  │         MCP Client              │    │
│  │   - stdio transport             │    │
│  │   - streamable-http transport   │    │
│  │   - OAuth for remote servers    │    │
│  └────────────────────────┬────────┘    │
└───────────────────────────┼─────────────┘
                            │
              ┌─────────────┴─────────────┐
              │     External MCP Server   │
              │   (e.g., filesystem, git) │
              └───────────────────────────┘
```

### MCP Server (Lower Priority)

Expose FreeCode tools via MCP for other clients. Deferred.

---

## Storage: SQLite + JSON Fallback

### SQLite Schema

```sql
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  project_path TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_accessed_at INTEGER NOT NULL,
  provider TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  turn_count INTEGER NOT NULL DEFAULT 0,
  message_count INTEGER NOT NULL DEFAULT 0,
  parent_id TEXT REFERENCES sessions(id),
  metadata TEXT
);

CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id),
  role TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  content TEXT
);

CREATE TABLE parts (
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL REFERENCES messages(id),
  type TEXT NOT NULL,
  content TEXT,
  tool_name TEXT,
  tool_args TEXT,
  tool_result TEXT,
  tool_state TEXT
);
```

### JSON Fallback

When SQLite unavailable, use JSON files in `~/.freecode/sessions/`.

---

## Bus Event System

### Event Types

```typescript
const BusEvents = {
  SessionDiff: "session.diff",
  SessionError: "session.error",
  SessionCreated: "session.created",
  SessionUpdated: "session.updated",
  ToolsChanged: "tools.changed",
  MCPToolsChanged: "mcp.tools.changed",
  SubagentStarted: "subagent.started",
  SubagentCompleted: "subagent.completed",
} as const;
```

### Bus vs Hooks

| Aspect | Bus | Hooks |
|--------|-----|-------|
| Purpose | Event distribution | Safety/transform |
| Blocking | No | PreToolUse can block |
| Subscribers | TUI, web, external | Internal processing |
| Examples | `session.diff`, `error` | `PreToolUse`, `PostToolUse` |

---

## Rollout Event Sourcing

### Events with Aggregate + Sequence

```typescript
interface RolloutEvent {
  id: string           // ULID
  seq: number          // Sequence within aggregate
  aggregateID: string  // sessionId, subagentId
  timestamp: number
}

export type RolloutEvent =
  | { type: "TurnStarted"; ... }
  | { type: "FunctionCall"; ... }
  | { type: "FunctionOutput"; ... duration_ms: number }
  | { type: "CompactOccurred"; beforeTokens: number; afterTokens: number }
  | { type: "SubagentStart"; ... }
  | { type: "HookTriggered"; blocked: boolean }
  // ... etc
```

### Storage

```
~/.freecode/rollout/
├── sessions/
│   └── {sessionId}/
│       └── events.jsonl    # Per-session event log
└── aggregates/
    └── {sessionId}/
        └── {seq}.json      # Individual event files
```

---

## File Structure (Target)

```
apps/core/src/
├── agent/
│   ├── loop.ts              # Main continuous loop
│   ├── session.ts           # Session state machine
│   ├── turn.ts              # Per-turn execution
│   ├── compact.ts           # Memory compaction (turn-aware)
│   ├── definitions.ts       # Agent definitions
│   ├── health.ts            # LoopHealth evaluation
│   └── types.ts
│
├── effect/
│   ├── context.ts           # Effect context
│   ├── layers.ts            # Layer compositions
│   └── runtime.ts           # Runtime config
│
├── tools/
│   ├── registry.ts          # Tool registry
│   ├── orchestrator.ts      # Tool execution + sandbox
│   ├── executor.ts          # Safe/risky split, batching
│   ├── read.ts
│   ├── write.ts
│   ├── edit.ts
│   ├── bash.ts
│   ├── grep.ts
│   ├── find.ts
│   ├── glob.ts
│   ├── agent.ts             # Sub-agent spawning
│   ├── skill.ts             # Skill invocation
│   └── permission.ts        # Permission checking
│
├── hooks/
│   ├── runtime.ts           # runPreToolUse, runPostToolUse, etc.
│   ├── registry.ts          # Hook registration
│   ├── PreToolUse.ts
│   ├── PostToolUse.ts
│   ├── PermissionRequest.ts
│   ├── PreCompact.ts
│   ├── PostCompact.ts
│   ├── SessionStart.ts
│   ├── UserPromptSubmit.ts
│   ├── SubagentStart.ts
│   ├── SubagentStop.ts
│   ├── Stop.ts
│   └── types.ts
│
├── bus/
│   ├── index.ts             # Bus interface
│   ├── events.ts           # Event definitions
│   ├── subscriber.ts       # Subscriber management
│   └── global-bus.ts        # Singleton
│
├── rollout/
│   ├── recorder.ts         # JSONL event writer
│   ├── types.ts            # Event definitions
│   └── replay.ts          # Debug replay
│
├── skills/
│   ├── manager.ts          # SkillsManager
│   ├── loader.ts           # Glob discovery
│   ├── registry.ts         # Skill registry
│   ├── injection.ts       # Render to prompt
│   ├── detection.ts       # Implicit invocation
│   ├── plugin.ts          # Plugin loading
│   └── types.ts
│
├── store/
│   ├── thread-store.ts     # ThreadStore interface
│   ├── sqlite-store.ts     # SQLite implementation
│   ├── json-store.ts       # JSON fallback
│   ├── migrations/         # Schema migrations
│   └── types.ts
│
├── mcp/
│   ├── client.ts           # MCP client (call servers)
│   ├── transport.ts        # stdio, http, sse
│   ├── oauth-provider.ts   # OAuth for remote
│   └── types.ts
│
├── session/
│   ├── types.ts            # ModelTurn, ToolCall, ToolResult, SessionState
│   ├── normalize/          # ProviderResponseNormalizer (SEPARATE)
│   │   ├── index.ts        # Factory
│   │   ├── normalize-claude.ts
│   │   ├── normalize-openai.ts
│   │   ├── normalize-gemini.ts
│   │   └── types.ts        # AssistantContent, etc.
│   ├── message-v2.ts       # Message parts
│   ├── llm.ts              # LLM service
│   ├── prompt/             # Provider prompts
│   │   ├── default.txt
│   │   ├── anthropic.txt
│   │   ├── chatgpt.txt
│   │   └── ...
│   └── processor.ts        # Stream processing
│
├── recovery/
│   ├── policy.ts           # RecoveryPolicy type
│   ├── manager.ts          # RecoveryManager service
│   └── errors.ts           # Error classification
│
└── browser/
    ├── controller.ts        # Playwright controller
    ├── providers/
    │   ├── chatgpt.ts
    │   ├── claude.ts
    │   └── types.ts
    └── types.ts
```

---

## Implementation Priority

### Phase 1: Core Loop (Foundation) ✅

1. **Effect/Layer setup** ✅ — Context, layers, runtime
2. **Canonical types** ✅ — ModelTurn, ToolCall, ToolResult, RecoveryPolicy, LoopHealth
3. **Rewrite loop.ts** ✅ — Continuous loop replacing single-pass
4. **ProviderResponseNormalizer** ✅ — Separate layer, factory pattern
5. **Session service** ✅ — State machine, history management

### Phase 2: Tool Execution

6. **Tool orchestrator** — Safe/risky split, parallel batching
7. **Loop health monitoring** ✅ — Heuristics evaluation
8. **Recovery manager** — RecoveryPolicy + Effect retry

### Phase 3: Hooks + Events

9. **Hook runtime** ✅ — All 10 event types
10. **Bus system** ✅ — PubSub for session events
11. **Rollout recorder** — JSONL event sourcing

### Phase 4: Extended Features

12. **Skills system** — Markdown + plugin auto-discovery
13. **MCP client** — Call external servers
14. **Sub-agents** — Session fork, agent definitions

### Phase 5: Persistence

15. **SQLite store** — ThreadStore implementation
16. **JSON fallback** — When SQLite unavailable

---

## Key Differences from Current Implementation

| Current | Target | Status |
|---------|--------|--------|
| Single-pass (one prompt → one response) | Continuous loop (cycles until no tools) | ✅ Done |
| No canonical runtime types | ModelTurn, ToolCall, ToolResult, RecoveryPolicy, LoopHealth | ✅ Done |
| Provider → parser directly | Provider → Normalizer → ModelTurn → Parser | ✅ Done |
| No hooks | 10 hook event types | ✅ Done |
| No Effect/Layer DI | Effect/Layer architecture | ⚠️ Simplified |
| No session persistence | SQLite + JSON storage | Pending |
| No sub-agents | Full agent tool with spawn | Pending |
| No skills system | Markdown + plugin skills | Pending |
| No MCP | MCP client first | Pending |
| In-process bash | Sandboxed bash (bubblewrap) | Pending |
| No loop detection | Multi-heuristic LoopHealth | ✅ Done |
| No error recovery | RecoveryPolicy + Effect retry | Pending |
| No turn-aware compaction | Compaction respects activeToolChain | Pending

---

## References

- **Claude Code** (ccleaks.com/architecture) — Continuous loop, streaming, 43 tools
- **codex-rs** (github.com/codex/codex-rs) — Turn-based run_turn(), hooks, sub-agents
- **opencode** (github.com/opencode-ai/opencode) — Effect/Layer DI, Bus + Hooks, plugin system