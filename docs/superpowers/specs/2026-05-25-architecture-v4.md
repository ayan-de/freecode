# FreeCode — Architecture Specification v4

**Date:** 2026-05-25
**Status:** Draft
**Supersedes:** `2026-05-25-architecture-v3.md`
**Based on:** Claude Code (codex-rs) + opencode (opencode-ai/opencode) analysis

---

## Overview

FreeCode is a CLI tool that drives AI coding assistants (ChatGPT, Claude, Gemini) via browser automation to assist with coding tasks. It uses a **thin-client architecture**: multiple frontends (TUI, VS Code, Web) delegate all intelligence to a shared CLI backend via JSON-RPC over stdin/stdout.

**This v4 updates v3 by:**

1. Adding architecture insights from deeper Claude Code/codex-rs analysis
2. Documenting the **gap between spec and implementation**
3. Clarifying the **web app position** (is it a frontend or something else?)
4. Adding **multi-agent orchestration** patterns observed in codex-rs
5. Refining the **skills system** with better implicit detection
6. Adding **Observability** section for logging/tracing/debugging
7. Clarifying the **package boundary** between `packages/shared` and `apps/core`

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
┌─────────────────┐   ┌─────────────────┐   ┌─────────────────┐
│      TUI        │   │    VS Code      │   │      Web        │
│  (apps/tui)     │   │  (apps/vscode)  │   │  (apps/web)     │
│                 │   │                 │   │                 │
│ Pure UI shell   │   │ Pure UI shell   │   │ Pure UI shell   │
│ - Renders TUI   │   │ - React webview │   │ - Next.js app   │
│ - IPC to CLI    │   │ - IPC to CLI    │   │ - IPC to CLI    │
│ - Zero biz logic│   │ - Zero biz logic│   │ - Zero biz logic│
└────────┬────────┘   └────────┬────────┘   └────────┬────────┘
         │                     │                     │
         │        JSON-RPC over stdin/stdout         │
         └─────────────────────┼─────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                              CLI Backend (apps/core)                         │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │                    Effect Runtime + Layer System                        ││
│  │    Services composed via Layer<Context> for dependency injection        ││
│  └─────────────────────────────────────────────────────────────────────────┘│
│                                                                             │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐ │
│  │    Agent    │  │   Browser   │  │   Context   │  │      Tools          │ │
│  │    Loop     │  │  Controller │  │   Engine    │  │  read write edit    │ │
│  │             │  │  +providers │  │  (file tree │  │  bash grep find     │ │
│  │  - session  │  │             │  │  + collect) │  │  agent skill        │ │
│  │  - LLM orch │  │  Playwright │  │             │  │  + plugin tools     │ │
│  │  - streaming│  │  + CDP      │  │             │  │                     │ │
│  │  - skills   │  │             │  │             │  │                     │ │
│  │  - rollout  │  │             │  │             │  │                     │ │
│  │  - agents   │  │             │  │             │  │                     │ │
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────────────┘ │
│                                                                             │
│  ┌─────────────────┐  ┌─────────────────────────────────────────────────┐   │
│  │     Parser      │  │                  Applier                        │   │
│  │  structured     │  │  - Diff generation                              │   │
│  │  markdown       │  │  - File writing                                  │   │
│  │  json           │  │  - Diff preview                                 │   │
│  └─────────────────┘  └─────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌─────────────────┐  ┌─────────────────────┐  ┌─────────────────────────┐  │
│  │     Hooks       │  │   Skills Manager    │  │   Rollout / Event Log   │  │
│  │  10 event types │  │   + Plugin registry │  │   Event sourcing        │  │
│  │  (middleware)   │  │   + skill discovery  │  │   (aggregates + seq)   │  │
│  └─────────────────┘  └─────────────────────┘  └─────────────────────────┘  │
│                                                                             │
│  ┌─────────────────────┐  ┌─────────────────────────────────────────────┐   │
│  │   Thread Store      │  │            MCP Server                       │   │
│  │   (SQLite + JSON)   │  │   (stdio + HTTP + OAuth)                    │   │
│  └─────────────────────┘  └─────────────────────────────────────────────┘   │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │                         Bus System (PubSub)                             ││
│  │  session.diff | mcp.tools.changed | session.error | tools.changed       ││
│  └─────────────────────────────────────────────────────────────────────────┘│
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │                    Observability (Logging + Tracing)                    ││
│  │  Structured logs | Span tracing | Session debug UI                     ││
│  └─────────────────────────────────────────────────────────────────────────┘│
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

## NEW: Web App Position

The web app (`apps/web`) is a **pure UI shell** like TUI and VSCode, not a different kind of backend.

**Design decision:** Web app renders FreeCode sessions in browser, communicates with CLI via IPC (JSON-RPC over WebSocket or HTTP).

**Implications:**

- `apps/web` should be a Next.js app that spawns CLI as subprocess
- CLI exposes HTTP endpoint (in addition to stdio) for web app connectivity
- Same JSON-RPC protocol as TUI/VSCode
- Session state lives in CLI (and Thread Store), not in web app

**Alternative (deferred):** Web app as pure frontend to a separate web server backend. This would require a different architecture.

---

## NEW: Observability Section

### Structured Logging

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

### Span Tracing

```typescript
// apps/core/src/observability/tracer.ts

interface Span {
  name: string
  startTime: number
  endTime?: number
  duration_ms?: number
  attributes: Record<string, string | number | boolean>
  events: SpanEvent[]
}

const startSpan = (name: string, attributes?: Record<string, string>) => Span
const endSpan = (span: Span) => span.duration_ms = Date.now() - span.startTime
const addSpanEvent = (span: Span, name: string, data?: Record<string, unknown>) => {...}
```

### Session Debug UI

For complex debugging, a session can be replayed:

```typescript
// Replay a session from rollout events
const replaySession = async (sessionId: string) => {
  const events = await rollout.getEvents(sessionId);
  for (const event of events) {
    logger.debug("replay", event.type, event);
    // Emit to debug UI
  }
};
```

---

## NEW: Multi-Agent Orchestration (from codex-rs analysis)

Claude Code's codex-rs has sophisticated multi-agent patterns:

### Agent Hierarchy

```
Primary Agent (orchestrator)
├── subagent:explore (read-only, max 20 turns)
├── subagent:scout (minimal permissions, max 10 turns)
├── subagent:test (standard permissions)
├── subagent:review (read-only)
└── subagent:compaction (memory management)
```

### Orchestration Patterns

**Pattern 1: Sequential Chaining**

```
Primary decides to spawn explore agent
→ Primary blocks, explore runs to completion
→ Primary resumes with explore's findings
```

**Pattern 2: Parallel Spawning**

```
Primary decides to analyze 3 files
→ Spawns 3 scout agents in parallel
→ Primary waits for all results
→ Aggregates findings
```

**Pattern 3: Hierarchical**

```
Primary: orchestration mode
  → Sub-agent A: explore (finds relevant files)
  → Sub-agent B: build (implements changes)
  → Sub-agent C: review (validates)
```

### Agent Communication

```typescript
// apps/core/src/agent/orchestration.ts

interface OrchestrationMessage {
  type: "invoke" | "result" | "error" | "progress";
  sourceAgent: string;
  targetAgent?: string;
  payload: unknown;
  seq: number;
}

const sendToAgent = (target: AgentRef, message: OrchestrationMessage) => Effect;
const receiveFromAgent = (source: AgentRef) => Effect<OrchestrationMessage>;
```

---

## NEW: Skills System Refinements

### Implicit Detection (from codex-rs patterns)

Skills can be implicitly triggered by command patterns or file patterns:

```typescript
// apps/core/src/skills/detection.ts

interface ImplicitTrigger {
  pattern: RegExp; // e.g., /\b(commit|git commit)\b/i
  files?: string[]; // e.g., ["**/*.py", "**/*.js"]
  priority: number; // Higher = checked first
}

const detectImplicitSkills = (prompt: string, context: Context) =>
  Effect<Skill[]>;

// Detection runs during context loading, before agent loop
const detected = yield * detectImplicitSkills(prompt, context);
// If matches found, skills are injected into prompt context
```

### Skill Composition

Skills can invoke other skills:

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
│   │Memory │  ◀── Hooks intercept every step (10 event types)               │
│   └───────┘                                                                 │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Flow:**

1. Model decides what tool to call (read, write, bash, grep, agent, skill, etc.)
2. **Hooks intercept** — pre-check input, post-check output, can block/modify
3. Tool executes (file system, shell, search, sub-agent, etc.)
4. Result flows back through hooks → model
5. **Bus emits events** — session.diff, tool.called, etc. (subscribers notified)
6. Rollout event is written (TurnStarted, FunctionCall, FunctionOutput, etc.)
7. Model decides next step or signals completion
8. Post-turn: run compaction check if history exceeds threshold

### Agent Definitions

Agents are formally defined with modes and permission profiles:

```typescript
// apps/core/src/agent/definitions.ts

export type AgentMode = "primary" | "subagent" | "orchestration";

export interface AgentDefinition {
  name: string;
  description: string;
  mode: AgentMode;
  permission: PermissionProfile;
  options?: {
    maxTurns?: number;
    timeout?: number;
    spawnPermission?: PermissionProfile;
  };
}

export const agents = {
  build: {
    name: "Build",
    description: "Execute code builds and compilations",
    mode: "primary",
    permission: PROFILES.elevated,
  },
  plan: {
    name: "Plan",
    description: "Create implementation plans",
    mode: "primary",
    permission: PROFILES.minimal,
  },
  general: {
    name: "General",
    description: "General coding assistance",
    mode: "primary",
    permission: PROFILES.standard,
  },
  explore: {
    name: "Explore",
    description: "Explore codebase and gather information",
    mode: "subagent",
    permission: PROFILES.readonly,
    options: { maxTurns: 20 },
  },
  scout: {
    name: "Scout",
    description: "Quick reconnaissance of code patterns",
    mode: "subagent",
    permission: PROFILES.minimal,
    options: { maxTurns: 10 },
  },
  compaction: {
    name: "Compaction",
    description: "Memory compaction and summarization",
    mode: "subagent",
    permission: PROFILES.minimal,
    options: { maxTurns: 5 },
  },
  review: {
    name: "Review",
    description: "Code review and feedback",
    mode: "subagent",
    permission: PROFILES.readonly,
  },
  test: {
    name: "Test",
    description: "Test generation",
    mode: "subagent",
    permission: PROFILES.standard,
  },
} as const satisfies Record<string, AgentDefinition>;
```

---

## Hooks System (Middleware)

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

### Hook Runtime

```typescript
// apps/core/src/hooks/runtime.ts

export const runPreToolUseHooks = Effect.fn("Hooks.runPreToolUse")(function* (
  toolCall: ToolCall,
  context: HookContext,
) {
  const hooks = yield* HookRegistry.getHooks("PreToolUse");
  let result: HookResult = { action: "continue" };

  for (const hook of hooks) {
    if (hook.preExecute) {
      result = yield* Effect.promise(() => hook.preExecute(context));
      if (result.action === "block") {
        yield* rollout.record({
          type: "HookTriggered",
          hookName: hook.name,
          event: "PreToolUse",
          blocked: true,
          reason: result.reason,
        });
        return result;
      }
      if (result.action === "inject") {
        context = { ...context, ...result.injectContext };
      }
    }
  }

  return { action: "continue" as const, context };
});

export const runPostToolUseHooks = Effect.fn("Hooks.runPostToolUse")(function* (
  toolCall: ToolCall,
  result: ToolResult,
  context: HookContext,
) {
  const hooks = yield* HookRegistry.getHooks("PostToolUse");

  for (const hook of hooks) {
    if (hook.postExecute) {
      const hookResult = yield* Effect.promise(() =>
        hook.postExecute(context, result),
      );
      if (hookResult.action === "inject") {
        result = {
          ...result,
          metadata: { ...result.metadata, ...hookResult.injectContext },
        };
      }
    }
  }

  return result;
});
```

### Core Hook Modules

```
apps/core/src/hooks/
├── runtime.ts           # runPreToolUseHooks, runPostToolUseHooks, etc.
├── registry.ts          # Hook registration and discovery
├── PermissionRequest.ts # Approval gates before dangerous operations
├── PreToolUse.ts        # Input validation, modification, blocking
├── PostToolUse.ts       # Output logging, modification
├── PreCompact.ts        # Pre-compaction context inspection
├── PostCompact.ts       # Post-compaction verification
├── SessionStart.ts      # Session initialization
├── UserPromptSubmit.ts  # User input validation
├── SubagentStart.ts     # Sub-agent lifecycle start
├── SubagentStop.ts      # Sub-agent lifecycle end
└── Stop.ts              # Termination handling
```

---

## Bus System (Event PubSub)

The Bus is a decoupled event system separate from Hooks. It publishes session events to subscribers (TUI, web, external consumers).

```typescript
// apps/core/src/bus/index.ts

export interface Bus {
  readonly publish: <E extends BusEvent>(
    event: E,
    data: BusEventData<E>,
  ) => Effect.Effect<void>;
  readonly subscribe: <E extends BusEvent>(
    event: E,
    handler: (data: BusEventData<E>) => void,
  ) => Effect.Effect<Unsubscribe>;
  readonly subscribeAll: (
    handler: (event: BusEvent, data: unknown) => void,
  ) => Effect.Effect<Unsubscribe>;
  readonly subscribeCallback: (
    event: BusEvent,
    callback: BusCallback,
  ) => Effect.Effect<void>;
}

// Bus events (decoupled from hooks)
export const BusEvents = {
  SessionDiff: BusEvent.define(
    "session.diff",
    Schema.Struct({ sessionId: SessionID, diff: Schema.Array(FileDiff) }),
  ),
  SessionError: BusEvent.define(
    "session.error",
    Schema.Struct({ sessionId: SessionID, error: ErrorData }),
  ),
  MCPToolsChanged: BusEvent.define(
    "mcp.tools.changed",
    Schema.Struct({ server: Schema.String }),
  ),
  SessionCreated: BusEvent.define(
    "session.created",
    Schema.Struct({ sessionId: SessionID, projectPath: Schema.String }),
  ),
  SessionUpdated: BusEvent.define(
    "session.updated",
    Schema.Struct({ sessionId: SessionID }),
  ),
  ToolsChanged: BusEvent.define(
    "tools.changed",
    Schema.Struct({
      added: Schema.Array(ToolDef),
      removed: Schema.Array(Schema.String),
    }),
  ),
  SubagentStarted: BusEvent.define(
    "subagent.started",
    Schema.Struct({ subagentId: Schema.String, parentId: SessionID }),
  ),
  SubagentCompleted: BusEvent.define(
    "subagent.completed",
    Schema.Struct({
      subagentId: Schema.String,
      parentId: SessionID,
      result: Schema.String,
    }),
  ),
} as const;
```

**Why separate Bus from Hooks:**

- Hooks: Safety/transform middleware (PreToolUse blocks, PostToolUse modifies)
- Bus: Event distribution to external consumers (TUI shows toast on error, web updates session list)

---

## Skills System + Plugin Architecture

Skills are reusable instruction sets that extend the agent's capabilities. In v4, skills are enhanced with a **plugin architecture** that allows them to also provide tools and hook handlers.

### Skill Structure

```
~/.freecode/skills/
├── .system/                    # Built-in system skills (installed with FreeCode)
│   ├── commit.skill.md        # Git commit workflow
│   ├── review.skill.md        # Code review
│   ├── test.skill.md          # Test generation
│   └── docs.skill.md          # Documentation generation
│
├── .user/                      # User-defined skills (~/.freecode/skills/)
│   └── custom.skill.md
│
├── .repo/                      # Repository-specific skills (.freecode/skills/ in repo)
│   └── myproject.skill.md
│
└── plugins/                    # User plugins (optional, can provide tools)
    └── my-plugin/
        ├── plugin.json         # Plugin manifest
        └── dist/
            └── index.js        # Plugin code with tools + hooks
```

### Skill Format

```markdown
---
name: commit
description: Generate a well-structured git commit message
scope: user # user | repo | system | admin
trigger: /\b(commit|git commit)\b/i
version: 1.0.0
---

You are a git commit expert. Given the diff output, write a conventional commit message:

1. First line: type(scope): brief description (50 chars max)
2. Body: detailed explanation if needed

Types: feat, fix, docs, style, refactor, test, chore
```

### Plugin Format (Extended Skills)

```json
// ~/.freecode/plugins/my-plugin/plugin.json
{
  "name": "my-plugin",
  "version": "1.0.0",
  "description": "Custom tools for my workflow",
  "tools": [
    {
      "id": "my-custom-tool",
      "description": "Does something custom",
      "inputSchema": {
        "type": "object",
        "properties": { "input": { "type": "string" } }
      }
    }
  ],
  "hooks": {
    "PreToolUse": "./dist/hooks.js",
    "PostToolUse": "./dist/hooks.js"
  },
  "mcp": {
    "command": "node",
    "args": ["./dist/mcp-server.js"],
    "transport": "stdio"
  }
}
```

### Skills Manager + Plugin Registry

```typescript
// apps/core/src/skills/
├── manager.ts         # SkillsManager — load, cache, render skills
├── loader.ts          # Load skills from filesystem (glob discovery)
├── registry.ts        # Skill registry with scope-based visibility
├── injection.ts       # Render skills into prompt context
├── detection.ts       # detectImplicitSkillInvocation(command) — pattern matching
├── plugin.ts          # Plugin loading + tool registration
├── plugin-registry.ts # Plugin registry + hook registration
└── types.ts           # Skill, SkillMetadata, SkillPolicy, SkillScope, Plugin
```

### Skill Discovery (Auto-Glob)

```typescript
// apps/core/src/skills/loader.ts

const discoverSkills = Effect.fnUntraced(function* () {
  const config = yield* ConfigService;
  const matches: SkillMatch[] = [];

  // Search patterns for each scope
  const searchPaths = [
    { pattern: "**/.freecode/skills/**/*.skill.md", scope: "repo" },
    { pattern: "~/.freecode/skills/**/*.skill.md", scope: "user" },
    { pattern: "{installDir}/.system/skills/**/*.skill.md", scope: "system" },
    // Support URL-based skills
    {
      pattern: "https://raw.githubusercontent.com/**/skills/*.skill.md",
      scope: "system",
    },
  ];

  for (const { pattern, scope } of searchPaths) {
    const paths = yield* Effect.promise(() => glob(pattern));
    for (const path of paths) {
      const content = yield* Effect.promise(() => fs.readFile(path, "utf-8"));
      const metadata = parseFrontmatter(content);
      matches.push({ path, scope, metadata, content });
    }
  }

  return matches;
});
```

---

## Rollout / Event Sourcing

Every session action is written to an append-only JSONL log for debugging, replay, and analytics. v4 implements proper **event sourcing** with aggregates and sequences.

### Event Schema

```typescript
// apps/core/src/rollout/types.ts

// Base event with aggregate + sequence
interface BaseEvent {
  id: string; // ULID for globally unique ordering
  seq: number; // Sequence number within aggregate
  aggregateID: string; // sessionId, subagentId, etc.
  timestamp: number;
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
    }
  | { type: "HookBlocked"; sessionId: string; hookName: string; reason: string }
  | { type: "ContextOverflow"; sessionId: string; beforeTokens: number }
  | {
      type: "ParseError";
      sessionId: string;
      turnId: string;
      parser: string;
      error: string;
    };

// Aggregate event definitions for proper event sourcing
export const RolloutEventDefs = {
  TurnStarted: SyncEvent.define({
    type: "turn.started",
    version: 1,
    aggregate: "sessionId",
    schema: Schema.Struct({
      turnId: Schema.String,
      timestamp: Schema.Number,
    }),
  }),
  FunctionCall: SyncEvent.define({
    type: "function.call",
    version: 1,
    aggregate: "sessionId",
    schema: Schema.Struct({
      turnId: Schema.String,
      tool: Schema.String,
      args: Schema.Record(Schema.String, Schema.Unknown),
      seq: Schema.Number,
    }),
  }),
  FunctionOutput: SyncEvent.define({
    type: "function.output",
    version: 1,
    aggregate: "sessionId",
    schema: Schema.Struct({
      turnId: Schema.String,
      tool: Schema.String,
      output: Schema.String,
      duration_ms: Schema.Number,
      seq: Schema.Number,
    }),
  }),
  // ...
};
```

### Event Storage

```
~/.freecode/
├── rollout/
│   ├── sessions/
│   │   └── {sessionId}/
│   │       └── events.jsonl      # Per-session event log with seq numbers
│   │
│   └── aggregates/
│       ├── {sessionId}/
│       │   └── {seq}.json        # Individual event files for replay
│       └── metadata.json         # Aggregate metadata
│
├── history.jsonl                # Global message history (append-only)
│
├── skills/                      # User skills (~/.freecode/skills/)
├── plugins/                     # User plugins (~/.freecode/plugins/)
└── state/                       # SQLite state (thread metadata, goals)
```

### Why Event Sourcing

- **Debugging**: Replay exactly what happened in a session using sequence numbers
- **Analytics**: Aggregate tool usage, error rates, token consumption
- **Replay**: Reconstruct session state from events by seq
- **Audit**: Full trace of every file modification, tool call, and decision
- **Distributed**: Events can be replayed to other replicas

---

## Thread Store (Session Persistence)

Sessions persist across restarts using **dual storage**: SQLite as primary with JSON file fallback.

### Storage Architecture

```
apps/core/src/store/
├── thread-store.ts    # ThreadStore interface + implementations
├── sqlite-store.ts    # SQLite implementation
├── json-store.ts       # JSON file fallback implementation
├── migrations/        # Schema migrations for SQLite
└── types.ts          # StoredThread, StoredTurn, StoredTurnItemsView
```

### ThreadStore Interface

```typescript
interface ThreadStore {
  // CRUD operations
  createThread(thread: StoredThread): Effect.Effect<string>;
  getThread(threadId: string): Effect.Effect<StoredThread | null>;
  updateThread(
    threadId: string,
    updates: Partial<StoredThread>,
  ): Effect.Effect<void>;
  archiveThread(threadId: string): Effect.Effect<void>;
  listThreads(filter?: ThreadFilter): Effect.Effect<StoredThread[]>;
  searchThreads(query: string): Effect.Effect<StoredThread[]>;

  // Turn operations
  appendTurnItem(
    threadId: string,
    turnId: string,
    item: TurnItem,
  ): Effect.Effect<void>;
  getTurnItems(threadId: string, turnId: string): Effect.Effect<TurnItem[]>;

  // Fork operations
  forkThread(threadId: string, point?: string): Effect.Effect<string>;
}
```

### SQLite Schema

```sql
-- sessions table
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
  metadata TEXT -- JSON for extra fields
);

-- messages table
CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id),
  role TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  content TEXT
);

-- parts table (for message parts: text, tool, reasoning, etc.)
CREATE TABLE parts (
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL REFERENCES messages(id),
  type TEXT NOT NULL,
  content TEXT,
  tool_name TEXT,
  tool_args TEXT,
  tool_result TEXT,
  tool_state TEXT,
  language TEXT,
  metadata TEXT
);

-- events table for event sourcing
CREATE TABLE events (
  id TEXT PRIMARY KEY,
  seq INTEGER NOT NULL,
  aggregate_id TEXT NOT NULL,
  type TEXT NOT NULL,
  data TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  UNIQUE(aggregate_id, seq)
);

CREATE INDEX idx_events_aggregate ON events(aggregate_id, seq);
```

### JSON Fallback

```typescript
// apps/core/src/store/json-store.ts
// When SQLite unavailable, use JSON files

const sessionPath = (sessionId: string) =>
  `${Global.Path.data}/sessions/${sessionId}/metadata.json`;

const messagesPath = (sessionId: string) =>
  `${Global.Path.data}/sessions/${sessionId}/messages.jsonl`;
```

---

## Sub-Agents

Complex tasks spawn focused sub-agents that run their own mini-loop. Inspired by Claude Code's multi-agent tooling and opencode's formal agent definitions.

### Sub-Agent Tool

```typescript
// apps/core/src/tools/agent.ts

interface AgentTool {
  name: "agent";
  description: "Spawn a sub-agent to handle a focused task in parallel";
  parameters: {
    task: string; // Task description for the sub-agent
    agent?: "explore" | "scout" | "review" | "test" | "build" | "plan"; // Agent type
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
│     → Bus: SubagentStarted(subagentId, parentId)           │
│                                                             │
│  2. Sub-agent runs mini-loop (owns session state)           │
│     - Has own turn history                                  │
│     - Reports progress via Bus events                       │
│                                                             │
│  3. Sub-agent completes or is stopped                       │
│     → Hook: SubagentStop(sessionId, subagentId, result)     │
│     → Bus: SubagentCompleted(subagentId, parentId, result)  │
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

### Session Fork

Sub-agents can fork sessions at any point:

```typescript
interface ForkResult {
  newSessionId: string;
  turnCount: number;
  messageCount: number;
}

session.fork({ sessionId, point: "current" }); // Fork at current position
session.fork({ sessionId, point: turnId }); // Fork at specific turn
```

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
  vcsInfo: VCSInfo; // git remote, branch, worktree info
}
```

**Loading order:**

1. **Project Bootstrap** — detect git worktree, load VCS info
2. **AGENTS.md** (priority) or **CLAUDE.md** — project conventions, preferences
3. **System skills** — bundled skills from `.system/`
4. **User skills** — from `~/.freecode/skills/` (auto-discovered via glob)
5. **Repo skills** — from `.freecode/skills/` in project root (auto-discovered)
6. **Recent history** — last N actions for context continuity
7. **Implicit skill detection** — match prompt against skill trigger patterns

### Project Bootstrap

```typescript
// apps/core/src/project/bootstrap.ts

export interface VCSInfo {
  root: string; // Git root directory
  worktree: string; // Current worktree (or root if not in worktree)
  branch: string; // Current branch
  remote: string | null; // Remote URL (e.g., github.com/user/repo)
  isDirty: boolean; // Uncommitted changes
}

export interface ProjectBootstrap {
  directory: string; // Working directory
  vcs: VCSInfo; // VCS information
  config: ConfigInfo; // .freecode.json contents
  conventions: string; // AGENTS.md or CLAUDE.md content
}
```

---

## Memory System

Tasks can run for hundreds of steps. To avoid hitting context limits:

- **Session memory:** Full conversation history accumulates per turn
- **Compaction:** When history exceeds threshold (~50k tokens), summarize and replace with compressed version
  - Hook: `PreCompact` — inspect context before compaction
  - Hook: `PostCompact` — verify compaction result
  - Rollout: `CompactOccurred` event with before/after token counts
- **Working memory:** Agent maintains orientation via recent history rollup

### Compaction Process

```typescript
// apps/core/src/agent/compact.ts

interface CompactionResult {
  success: boolean;
  beforeTokens: number;
  afterTokens: number;
  summary: string;
}

const runCompaction = Effect.gen(function* () {
  const session = yield* SessionService;
  const history = yield* session.getHistory();

  // Pre-compaction hook
  const preResult = yield* hooks.runPreCompact(history);
  if (preResult.action === "block") {
    return { success: false, reason: preResult.reason };
  }

  // Generate summary using compaction agent
  const summaryAgent = agents.compaction;
  const summary = yield* LLMService.summarize(summaryAgent, history);

  // Replace old history with compressed version
  const newHistory = yield* session.compactWith(summary);

  // Post-compaction hook
  yield* hooks.runPostCompact(newHistory);

  // Record event
  yield* rollout.record({
    type: "CompactOccurred",
    beforeTokens: preResult.context.tokenCount,
    afterTokens: newHistory.tokenCount,
  });

  return {
    success: true,
    beforeTokens: preResult.context.tokenCount,
    afterTokens: newHistory.tokenCount,
    summary,
  };
});
```

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
Tool Call → Hook: PreToolUse → Permission Check → Bus: tool.called → Sandbox Selection → Execute
                                                                                ↓
                                                                        Hook: PostToolUse
                                                                                ↓
Bus: tool.completed ← Result ← Format Output ← Sandbox Execution
```

### Tool Sandbox Levels

- `minimal` — read-only, no network, no shell
- `standard` — read + write, limited shell
- `elevated` — full file access, unrestricted shell
- `sandboxed` — bubblewrap/landlock/seatbelt isolation

### Permission Profiles

```typescript
interface PermissionProfile {
  name: string;
  fileRead: boolean;
  fileWrite: boolean;
  network: boolean;
  shell: boolean;
  subprocess: boolean;
  mcpServers: string[]; // allowed MCP server names
}

const PROFILES = {
  minimal: {
    fileRead: true,
    fileWrite: false,
    network: false,
    shell: false,
    subprocess: false,
    mcpServers: [],
  },
  readonly: {
    fileRead: true,
    fileWrite: false,
    network: true,
    shell: false,
    subprocess: false,
    mcpServers: [],
  },
  standard: {
    fileRead: true,
    fileWrite: true,
    network: false,
    shell: true,
    subprocess: false,
    mcpServers: [],
  },
  elevated: {
    fileRead: true,
    fileWrite: true,
    network: true,
    shell: true,
    subprocess: true,
    mcpServers: ["*"],
  },
} as const;
```

---

## MCP Server Integration

FreeCode v4 implements full MCP server integration with multiple transport options and OAuth support.

### MCP Modes

```bash
# Run FreeCode as MCP server (stdio protocol)
freecode mcp-server

# Run FreeCode with external MCP server (HTTP)
freecode mcp --external

# Run FreeCode as MCP client calling external servers
freecode mcp --connect https://server.example.com/mcp
```

### MCP Transport Support

| Transport         | Use Case                    | opencode Reference              |
| ----------------- | --------------------------- | ------------------------------- |
| `stdio`           | Local processes, CLI tools  | `StdioClientTransport`          |
| `streamable-http` | Remote servers, production  | `StreamableHTTPClientTransport` |
| `sse`             | Server-Sent Events fallback | `SSEClientTransport`            |

### MCP OAuth (Remote Servers)

```typescript
// apps/core/src/mcp/oauth-provider.ts

interface OAuthConfig {
  clientId: string;
  clientSecret?: string;
  authorizationUrl: string;
  tokenUrl: string;
  scopes: string[];
}

const createOAuthProvider = (config: OAuthConfig) =>
  Effect.gen(function* () {
    // OAuth 2.0 with PKCE support for secure auth
    const provider = yield* OAuthProvider.create(config);
    return provider;
  });
```

### MCP Tool Conversion

```typescript
// apps/core/src/mcp/index.ts

function convertMcpTool(
  mcpTool: MCPToolDef,
  client: MCPClient,
  timeout?: number,
): Tool {
  return dynamicTool({
    id: `mcp.${client.name}.${mcpTool.name}`,
    description: mcpTool.description ?? "",
    inputSchema: jsonSchema(mcpTool.inputSchema),
    execute: async (args: unknown) => {
      const result = await client.callTool(
        { name: mcpTool.name, arguments: args },
        CallToolResultSchema,
        { timeout },
      );
      return formatToolResult(result);
    },
  });
}
```

### Tools Changed Event

When MCP server tools change, Bus publishes event:

```typescript
// apps/core/src/mcp/index.ts

// Periodically poll MCP servers for tool changes
const pollMcpTools = Effect.gen(function* () {
  const previousTools = new Map<string, MCPToolDef[]>();

  while (true) {
    yield* Effect.sleep(5000); // Poll every 5 seconds

    for (const [serverName, client] of mcpClients) {
      const currentTools = await client.listTools();
      const prev = previousTools.get(serverName) ?? [];

      if (!deepEqual(prev, currentTools)) {
        yield* Bus.publish(BusEvents.MCPToolsChanged, { server: serverName });
        previousTools.set(serverName, currentTools);
      }
    }
  }
});
```

---

## Message Part System

Messages are stored with typed parts for rich representation:

```typescript
// apps/core/src/session/message-v2.ts

export const MessagePart = Schema.Union({
  TextPart: Schema.Struct({
    type: Schema.Literal("text"),
    text: Schema.String,
  }),
  ReasoningPart: Schema.Struct({
    type: Schema.Literal("reasoning"),
    text: Schema.String,
    signature: Schema.String,  // For verification
  }),
  ToolPart: Schema.Struct({
    type: Schema.Literal("tool"),
    tool: Schema.String,
    callID: Schema.String,
    state: Schema.Union({
      input: Schema.Literal("input"),
      output: Schema.Literal("output"),
      error: Schema.Literal("error"),
    }),
    input?: Schema.String,      // When state === "input"
    output?: Schema.String,      // When state === "output"
    error?: Schema.String,       // When state === "error"
  }),
  PatchPart: Schema.Struct({
    type: Schema.Literal("patch"),
    hash: Schema.String,         // Content hash for verification
    files: Schema.Array(Schema.String),  // Affected file paths
    diff?: Schema.String,        // Optional inline diff
  }),
  SnapshotPart: Schema.Struct({
    type: Schema.Literal("snapshot"),
    description: Schema.String,
    timestamp: Schema.Number,
    tokenCount: Schema.Number,
  }),
  StepStartPart: Schema.Struct({
    type: Schema.Literal("step_start"),
    stepName: Schema.String,
    stepType: Schema.String,
  }),
  StepFinishPart: Schema.Struct({
    type: Schema.Literal("step_finish"),
    stepName: Schema.String,
    stepType: Schema.String,
    outcome: Schema.String,
  }),
})
```

### Structured Error Types

```typescript
// apps/core/src/errors/named-error.ts

export const NamedError = {
  create: <Name extends string, const Data extends Schema.Schema.Type<any>>(
    name: Name,
    dataSchema: Data,
  ) => {
    return class extends Error {
      readonly name = name;
      constructor(readonly data: Schema.Schema.Type<Data>) {
        super(name);
      }
    };
  },
};

// Defined errors
export const ContextOverflowError = NamedError.create(
  "ContextOverflowError",
  Schema.Struct({
    beforeTokens: Schema.Number,
    threshold: Schema.Number,
    message: Schema.String,
  }),
);

export const ParseError = NamedError.create(
  "ParseError",
  Schema.Struct({
    parser: Schema.String,
    raw: Schema.String,
    error: Schema.String,
  }),
);

export const PermissionDeniedError = NamedError.create(
  "PermissionDeniedError",
  Schema.Struct({
    tool: Schema.String,
    profile: Schema.String,
    reason: Schema.String,
  }),
);

export const SubagentFailedError = NamedError.create(
  "SubagentFailedError",
  Schema.Struct({
    subagentId: Schema.String,
    agentType: Schema.String,
    error: Schema.String,
  }),
);

export const MCPToolError = NamedError.create(
  "MCPToolError",
  Schema.Struct({
    server: Schema.String,
    tool: Schema.String,
    error: Schema.String,
  }),
);
```

---

## Provider-Specific Prompts

LLM prompts are provider-specific because different models have different capabilities and formats:

```
apps/core/src/session/prompt/
├── default.txt         # Fallback prompt
├── anthropic.txt      # Claude-specific formatting (XML tags, etc.)
├── openai.txt          # OpenAI-specific formatting
├── gemini.txt          # Gemini-specific formatting
├── chatgpt.txt         # ChatGPT web-specific
├── copilot.txt         # Copilot-specific
├── plan-mode.txt       # Planning mode system prompt
├── subagent.txt        # Sub-agent system prompt
└── compaction.txt      # Memory compaction system prompt
```

### Provider Prompt Selection

```typescript
// apps/core/src/session/prompt/loader.ts

const loadProviderPrompt = Effect.fn("Prompt.loadProvider")(function* (
  provider: ProviderID,
  mode: "primary" | "subagent" | "plan" | "compaction",
) {
  const promptPath = `${__dirname}/${provider}.txt`;
  const fallbackPath = `${__dirname}/default.txt`;

  let content: string;
  try {
    content = yield* Effect.promise(() => fs.readFile(promptPath, "utf-8"));
  } catch {
    content = yield* Effect.promise(() => fs.readFile(fallbackPath, "utf-8"));
  }

  if (mode !== "primary") {
    const modePath = `${__dirname}/${mode}.txt`;
    const modeContent = yield* Effect.promise(() =>
      fs.readFile(modePath, "utf-8"),
    );
    content = content + "\n\n" + modeContent;
  }

  return content;
});
```

---

## Config Schema Validation

Config files are validated at runtime using Zod:

```typescript
// apps/core/src/config/config.ts

import { z } from "zod";

const PermissionProfileSchema = z.object({
  fileRead: z.boolean(),
  fileWrite: z.boolean(),
  network: z.boolean(),
  shell: z.boolean(),
  subprocess: z.boolean(),
  mcpServers: z.array(z.string()),
});

const McpServerSchema = z.object({
  name: z.string(),
  command: z.string(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string()).optional(),
  transport: z.enum(["stdio", "streamable-http", "sse"]).default("stdio"),
  auth: z
    .object({
      type: z.literal("oauth"),
      clientId: z.string(),
      authorizationUrl: z.string(),
      tokenUrl: z.string(),
    })
    .optional(),
});

const ModelInfoSchema = z.object({
  provider: z.string(),
  model: z.string(),
  apiKey: z.string().optional(),
  baseUrl: z.string().optional(),
});

export const ConfigSchema = z.object({
  shell: z.string().default("/bin/bash"),
  model: ModelInfoSchema,
  small_model: ModelInfoSchema.optional(),
  default_agent: z.enum(["general", "build", "plan"]).default("general"),
  username: z.string().optional(),
  mode: z.enum(["chat", "plan", "batch"]).default("chat"),

  skills: z.object({
    dirs: z.array(z.string()).default([]),
    disabled: z.array(z.string()).default([]),
  }),

  permission: z.record(PermissionProfileSchema),

  mcp: z.object({
    servers: z.array(McpServerSchema).default([]),
    pollInterval: z.number().default(5000),
  }),

  plugins: z.object({
    dirs: z.array(z.string()).default([]),
    enabled: z.array(z.string()).default([]),
  }),

  rollout: z.object({
    dir: z.string().default("~/.freecode/rollout"),
    enabled: z.boolean().default(true),
    maxSessionEvents: z.number().default(10000),
  }),
});

export type Config = z.infer<typeof ConfigSchema>;
```

---

## Win32 Support

Cross-platform support including Windows:

```typescript
// apps/core/src/platform/win32.ts

export const win32DisableProcessedInput = Effect.fn("Platform.win32.disableProcessedInput")(function* () {
  if (process.platform !== "win32") return

  yield* Effect.promise(() => {
    const stdin = process.stdin
    // Disable processed input mode for raw key handling
    const SetConsoleMode = ffi.DynamicLibrary("kernel32.dll").get("SetConsoleMode")
    // ...
  })
})

export const win32InstallCtrlCHandler = Effect.fn("Platform.win32.installCtrlCHandler")(function* (
  handler: () => void
) {
  if (process.platform !== "win32") return

  yield* Effect.promise(() => {
    // Register handler for Ctrl+C in console
    ffi.ForeignFunction.call(...)
  })
})
```

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
│       │   ├── errors/
│       │   │   └── named-error.ts       # Structured error types
│       │   └── index.ts
│       └── package.json
│
├── apps/
│   ├── cli/                             # ALL intelligence lives here
│   │   └── src/
│   │       ├── index.ts                 # Entry point, CLI argument parsing (yargs)
│   │       ├── effect/                  # Effect layer definitions
│   │       │   ├── context.ts           # Effect context setup
│   │       │   ├── layers.ts            # Layer compositions
│   │       │   └── runtime.ts           # Effect runtime config
│   │       │
│   │       ├── server.ts               # JSON-RPC stdin/stdout server
│   │       │
│   │       ├── agent/                   # Agent loop + session management
│   │       │   ├── loop.ts              # Main agent turn loop
│   │       │   ├── session.ts          # Session state + history
│   │       │   ├── turn.ts              # Per-turn execution
│   │       │   ├── compact.ts           # Memory compaction logic
│   │       │   ├── definitions.ts       # Agent definitions (modes, permissions)
│   │       │   ├── orchestration.ts     # Multi-agent orchestration
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
│   │       │   ├── collector.ts        # Context collection engine
│   │       │   ├── file-tree.ts        # File tree generation
│   │       │   └── types.ts
│   │       │
│   │       ├── parser/                  # Response parsing
│   │       │   ├── registry.ts         # Parser registry + chain
│   │       │   ├── extractors/
│   │       │   │   ├── index.ts
│   │       │   │   ├── structured.ts   # FILE: path + code blocks
│   │       │   │   ├── markdown.ts     # Markdown code blocks
│   │       │   │   └── json.ts        # JSON { changes: [] }
│   │       │   └── types.ts
│   │       │
│   │       ├── tools/                   # Tool definitions + execution
│   │       │   ├── index.ts            # Tool registry
│   │       │   ├── types.ts           # ToolDef, ToolContext, ToolResult
│   │       │   ├── orchestrator.ts    # Tool approval + sandbox + execution
│   │       │   ├── router.ts          # Route tool calls to handlers
│   │       │   ├── read.ts
│   │       │   ├── write.ts
│   │       │   ├── edit.ts
│   │       │   ├── bash.ts
│   │       │   ├── grep.ts
│   │       │   ├── find.ts
│   │       │   ├── glob.ts
│   │       │   ├── agent.ts           # Sub-agent spawning
│   │       │   ├── skill.ts           # Skill invocation
│   │       │   └── permission.ts      # Permission profile checking
│   │       │
│   │       ├── applier/                 # File diff + write
│   │       │   ├── index.ts            # Diff + apply logic
│   │       │   ├── differ.ts           # Generate diffs
│   │       │   └── writer.ts           # File system operations
│   │       │
│   │       ├── hooks/                   # Hook middleware system
│   │       │   ├── runtime.ts          # runPreToolUseHooks, runPostToolUseHooks, etc.
│   │       │   ├── registry.ts        # Hook registration + discovery
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
│   │       ├── bus/                     # PubSub event system (decoupled from hooks)
│   │       │   ├── index.ts            # Bus interface + implementation
│   │       │   ├── events.ts          # Bus event definitions
│   │       │   ├── subscriber.ts      # Subscriber management
│   │       │   └── global-bus.ts       # Global singleton bus
│   │       │
│   │       ├── skills/                  # Skills system + plugins
│   │       │   ├── manager.ts         # SkillsManager — load, cache, render
│   │       │   ├── loader.ts          # Load skills via glob discovery
│   │       │   ├── registry.ts        # Skill registry + scope filtering
│   │       │   ├── injection.ts       # Render skills into prompt context
│   │       │   ├── detection.ts      # detectImplicitSkillInvocation()
│   │       │   ├── plugin.ts         # Plugin loading + tool registration
│   │       │   ├── plugin-registry.ts # Plugin registry
│   │       │   └── types.ts          # Skill, SkillMetadata, Plugin, PluginTool
│   │       │
│   │       ├── rollout/                 # Event sourcing / audit log
│   │       │   ├── recorder.ts       # RolloutRecorder — write JSONL events
│   │       │   ├── types.ts          # RolloutEvent types + SyncEvent defs
│   │       │   ├── history.ts        # ~/.freecode/history.jsonl writer
│   │       │   └── replay.ts        # Replay events for debugging
│   │       │
│   │       ├── store/                   # Thread/session persistence
│   │       │   ├── thread-store.ts    # ThreadStore interface
│   │       │   ├── sqlite-store.ts    # SQLite implementation
│   │       │   ├── json-store.ts     # JSON file fallback
│   │       │   ├── migrations/       # Schema migrations
│   │       │   └── types.ts         # StoredThread, StoredTurn
│   │       │
│   │       ├── mcp/                     # MCP server integration
│   │       │   ├── server.ts          # MCP server implementation
│   │       │   ├── client.ts          # MCP client for external servers
│   │       │   ├── oauth-provider.ts  # OAuth 2.0 for remote servers
│   │       │   ├── oauth-callback.ts  # OAuth callback handling
│   │       │   ├── transport.ts      # Transport abstraction (stdio, http, sse)
│   │       │   ├── convert-tool.ts   # MCP tool → FreeCode tool conversion
│   │       │   └── types.ts
│   │       │
│   │       ├── session/                 # Session + message handling
│   │       │   ├── message-v2.ts      # Message part schemas (Text, Reasoning, Tool, Patch, etc.)
│   │       │   ├── llm.ts             # LLM service + provider prompts
│   │       │   ├── prompt/            # Provider-specific prompts
│   │       │   │   ├── default.txt
│   │       │   │   ├── anthropic.txt
│   │       │   │   ├── openai.txt
│   │       │   │   ├── gemini.txt
│   │       │   │   ├── chatgpt.txt
│   │       │   │   ├── copilot.txt
│   │       │   │   ├── plan-mode.txt
│   │       │   │   ├── subagent.txt
│   │       │   │   └── compaction.txt
│   │       │   └── processor.ts       # Stream processing (handleEvent)
│   │       │
│   │       ├── project/                 # Project bootstrap + VCS awareness
│   │       │   ├── bootstrap.ts       # Project initialization
│   │       │   ├── instance-context.ts # InstanceContext interface
│   │       │   ├── vcs.ts            # Git worktree detection
│   │       │   └── conventions.ts    # AGENTS.md / CLAUDE.md loading
│   │       │
│   │       ├── config/                 # Config loading + Zod validation
│   │       │   ├── config.ts         # ConfigSchema + parsing
│   │       │   ├── loader.ts        # Load from .freecode.json
│   │       │   └── defaults.ts      # Default config values
│   │       │
│   │       ├── observability/          # Logging + tracing
│   │       │   ├── logger.ts        # Structured logger
│   │       │   ├── tracer.ts        # Span tracing
│   │       │   └── index.ts
│   │       │
│   │       ├── errors/                 # Structured error types
│   │       │   ├── index.ts
│   │       │   └── named-error.ts   # NamedError factory
│   │       │
│   │       └── platform/               # Platform-specific code
│   │           ├── win32.ts          # Windows support
│   │           └── index.ts
│   │
│   ├── tui/                             # Pure UI shell — no business logic
│   │   └── src/
│   │       ├── index.ts              # Entry point: mounts TUI, connects IPC
│   │       ├── commands/              # TUI-specific commands (model select, etc.)
│   │       │   ├── index.ts
│   │       │   └── built-in.ts
│   │       ├── ipc/
│   │       │   └── client.ts          # JSON-RPC client to CLI
│   │       ├── stores/                # Zustand stores for UI state
│   │       │   └── toast-store.ts    # Toast/notification state
│   │       └── assets/
│   │           └── logo.ts
│   │
│   ├── vscode/                          # Pure UI shell — no business logic
│   │   └── src/
│   │       ├── extension.ts            # VS Code extension entry point
│   │       ├── chat/
│   │       │   ├── ChatView.tsx        # Main webview panel
│   │       │   ├── MessageList.tsx
│   │       │   ├── MessageInput.tsx
│   │       │   └── parts/            # Message part renderers
│   │       │       ├── TextPart.tsx
│   │       │       ├── CodePart.tsx
│   │       │       ├── ToolPart.tsx
│   │       │       └── ReasoningPart.tsx
│   │       ├── stores/
│   │       │   └── chat-store.ts      # UI state only (messages, status)
│   │       └── ipc/
│   │           └── client.ts          # JSON-RPC client to CLI
│   │
│   └── web/                             # Pure UI shell — Next.js app
│       ├── src/
│       │   ├── app/
│       │   │   ├── page.tsx           # Main page
│       │   │   ├── session/
│       │   │   │   └── [id]/page.tsx  # Session view
│       │   │   └── api/
│       │   │       └── cli/route.ts   # Proxy to CLI
│   │   ├── components/
│   │   │   ├── chat/
│   │   │   │   ├── MessageList.tsx
│   │   │   │   ├── MessageInput.tsx
│   │   │   │   └── parts/
│   │   │   │       ├── TextPart.tsx
│       │   │   │       ├── CodePart.tsx
│       │   │   │       ├── ToolPart.tsx
│       │   │   │       └── ReasoningPart.tsx
│   │   │   └── ui/
│   │   │       └── (shadcn components)
│   │   ├── stores/
│   │   │   └── session-store.ts       # UI state (Zustand)
│   │   └── ipc/
│   │       └── client.ts              # JSON-RPC client to CLI (WebSocket or HTTP)
│       └── package.json
│
└── .freecode/                          # User-level FreeCode config (home dir)
    ├── skills/                         # User-installed skills (~/.freecode/skills/)
    ├── plugins/                        # User plugins (~/.freecode/plugins/)
    ├── rollout/                        # Session event logs
    └── sessions/                       # Session storage (SQLite + JSON)
```

---

## IPC Protocol

CLI exposes a JSON-RPC 2.0 interface over stdin/stdout (and HTTP for web). Both TUI, VSCode, and Web use the same protocol.

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

| Method              | Params                                            | Returns                      | Description                        |
| ------------------- | ------------------------------------------------- | ---------------------------- | ---------------------------------- |
| `tools.list`        | —                                                 | `ToolListItem[]`             | List available tools               |
| `tools.call`        | `{ name: string, args: Record<string, unknown> }` | `ToolResult`                 | Execute a tool                     |
| `session.start`     | `{ projectPath: string, provider?: string }`      | `{ sessionId: string }`      | Start a new session                |
| `session.send`      | `{ sessionId: string, message: string }`          | `StreamResponse` (streaming) | Send a message                     |
| `session.stop`      | `{ sessionId: string }`                           | `void`                       | Abort current turn                 |
| `session.resume`    | `{ sessionId: string }`                           | `{ sessionId: string }`      | Resume existing session            |
| `session.fork`      | `{ sessionId: string, point?: string }`           | `{ newSessionId: string }`   | Fork session at point              |
| `session.list`      | `{ filter?: ThreadFilter }`                       | `StoredThread[]`             | List sessions                      |
| `providers.list`    | —                                                 | `ProviderInfo[]`             | List available AI providers        |
| `skills.list`       | `{ scope?: SkillScope }`                          | `SkillMetadata[]`            | List available skills              |
| `skills.invoke`     | `{ name: string, context?: object }`              | `SkillResult`                | Invoke a skill                     |
| `hooks.list`        | —                                                 | `HookDefinition[]`           | List registered hooks              |
| `rollout.getEvents` | `{ sessionId: string, fromSeq?: number }`         | `RolloutEvent[]`             | Get session events (from sequence) |
| `config.get`        | —                                                 | `Config`                     | Get current config                 |
| `config.set`        | `{ patch: Partial<Config> }`                      | `Config`                     | Update config                      |
| `mcp.listServers`   | —                                                 | `McpServerInfo[]`            | List configured MCP servers        |
| `mcp.addServer`     | `{ config: McpServerConfig }`                     | `void`                       | Add MCP server                     |
| `mcp.removeServer`  | `{ name: string }`                                | `void`                       | Remove MCP server                  |

### Streaming Response

```typescript
interface StreamResponse {
  type:
    | "text"
    | "reasoning"
    | "code"
    | "tool"
    | "done"
    | "error"
    | "skill"
    | "subagent"
    | "patch";
  content: string;
  toolName?: string; // when type === "tool"
  toolArgs?: unknown; // when type === "tool"
  toolResult?: string; // when type === "tool" (after execution)
  skillName?: string; // when type === "skill"
  subagentId?: string; // when type === "subagent"
  patchFiles?: string[]; // when type === "patch"
}
```

---

## Boundary: What Lives Where

| Concern                               | CLI | TUI          | VSCode       | Web          |
| ------------------------------------- | --- | ------------ | ------------ | ------------ |
| Effect/Layer DI                       | ✅  | ❌           | ❌           | ❌           |
| Browser automation (Playwright/CDP)   | ✅  | ❌           | ❌           | ❌           |
| Provider adapters (ChatGPT, Claude)   | ✅  | ❌           | ❌           | ❌           |
| Agent loop + session management       | ✅  | ❌           | ❌           | ❌           |
| Context collection (file tree)        | ✅  | ❌           | ❌           | ❌           |
| Response parsing                      | ✅  | ❌           | ❌           | ❌           |
| Tool execution                        | ✅  | ❌           | ❌           | ❌           |
| File diff + writing                   | ✅  | ❌           | ❌           | ❌           |
| Skills loading + injection            | ✅  | ❌           | ❌           | ❌           |
| Plugin loading + tool registration    | ✅  | ❌           | ❌           | ❌           |
| Hooks (10 event types)                | ✅  | ❌           | ❌           | ❌           |
| Bus PubSub events                     | ✅  | ❌           | ❌           | ❌           |
| Rollout event logging                 | ✅  | ❌           | ❌           | ❌           |
| Thread store (SQLite + JSON)          | ✅  | ❌           | ❌           | ❌           |
| MCP server/client                     | ✅  | ❌           | ❌           | ❌           |
| Provider-specific prompts             | ✅  | ❌           | ❌           | ❌           |
| Config Zod validation                 | ✅  | ❌           | ❌           | ❌           |
| Project VCS bootstrap                 | ✅  | ❌           | ❌           | ❌           |
| Observability (logging, tracing)      | ✅  | ❌           | ❌           | ❌           |
| TUI rendering                         | ❌  | ✅           | ❌           | ❌           |
| VS Code webview                       | ❌  | ❌           | ✅           | ❌           |
| Web rendering (Next.js)               | ❌  | ❌           | ❌           | ✅           |
| UI state (messages, status, theme)    | ❌  | ✅ (Zustand) | ✅ (Zustand) | ✅ (Zustand) |
| Bus event subscription (toasts, etc.) | ❌  | ✅           | ✅           | ✅           |
| IPC client                            | ❌  | ✅           | ✅           | ✅           |

---

## Implementation Gap Analysis

### What's in v3/v4 spec but NOT yet implemented:

| Component                        | Status             | Notes                                     |
| -------------------------------- | ------------------ | ----------------------------------------- |
| **Effect/Layer DI**              | ❌ Not implemented | Spec describes it, no `effect/` directory |
| **Hook system (10 event types)** | ❌ Not implemented | No `hooks/` directory                     |
| **Bus system**                   | ❌ Not implemented | No `bus/` directory                       |
| **Skills system**                | ❌ Not implemented | No `skills/` directory                    |
| **Plugin architecture**          | ❌ Not implemented | No `plugins/` support                     |
| **Rollout/Event sourcing**       | ❌ Not implemented | No `rollout/` directory                   |
| **Thread Store**                 | ❌ Not implemented | No `store/` directory                     |
| **Sub-agents**                   | ❌ Not implemented | No multi-agent support                    |
| **MCP server integration**       | ❌ Not implemented | No `mcp/` directory                       |
| **Provider-specific prompts**    | ❌ Not implemented | No `session/prompt/`                      |
| **Config Zod validation**        | ❌ Not implemented | No `config/` directory                    |
| **VCS-aware bootstrap**          | ❌ Not implemented | No `project/` directory                   |
| **Structured error types**       | ❌ Not implemented | No `errors/` directory                    |
| **Observability**                | ❌ Not implemented | No `observability/` directory             |
| **Orchestration patterns**       | ❌ Not implemented | No `agent/orchestration.ts`               |
| **Windows support**              | ❌ Not implemented | No `platform/` directory                  |

### What's partially implemented:

| Component              | Status     | Notes                                                                                              |
| ---------------------- | ---------- | -------------------------------------------------------------------------------------------------- |
| **Agent loop**         | ⚠️ Partial | `apps/core/src/agent/loop.ts` exists but basic, no Effect/Layer                                    |
| **Tools**              | ⚠️ Partial | Only `read`, `write` implemented; missing `bash`, `edit`, `grep`, `find`, `glob`, `agent`, `skill` |
| **Browser controller** | ⚠️ Partial | `apps/core/src/browser/` exists with providers                                                     |
| **Parser**             | ⚠️ Partial | `apps/core/src/parser/` with extractors                                                            |
| **Context collector**  | ⚠️ Partial | `apps/core/src/context/` exists                                                                    |
| **Applier**            | ⚠️ Partial | `apps/core/src/applier/` exists                                                                    |
| **Server (JSON-RPC)**  | ⚠️ Partial | `apps/core/src/server.ts` exists but limited methods                                               |

### What's NOT in spec but exists:

| Component                 | Notes                                                       |
| ------------------------- | ----------------------------------------------------------- |
| `apps/web/`               | Next.js app exists but not integrated into thin-client arch |
| `apps/tui/src/lib/utils/` | Empty directory                                             |

---

## Key Design Decisions

### 1. Thin Client Architecture (unchanged from v1)

**Decision:** TUI, VSCode, and Web are pure presentation layers. All intelligence is in CLI.

**Rationale:** Avoids code duplication across frontends. Adding a new provider, parser, or tool only requires changing one place.

### 2. Long-Running CLI Daemon (unchanged from v1)

**Decision:** CLI stays alive between turns, maintaining browser connection and session state.

**Rationale:** Starting a new browser + logging in per prompt is slow (5-15 seconds). A persistent connection enables sub-second response for subsequent turns.

**Trade-off:** If CLI crashes, session is lost. **Mitigation:** Thread store persists session; on restart, user can resume.

### 3. Effect/Layer Architecture (NEW in v3)

**Decision:** Use Effect framework for dependency injection and async operations.

**Rationale:** Cleaner composition of services, built-in error handling, structured concurrency, testable via `Effect.gen`.

**Reference:** Inspired by opencode's architecture.

### 4. Dual Bus + Hooks (NEW in v3)

**Decision:** Separate concerns — Hooks for safety/transform middleware, Bus for event distribution.

**Rationale:**

- Hooks: `PreToolUse` blocks dangerous calls, `PostToolUse` modifies output
- Bus: Publishes `session.diff`, `tools.changed`, `session.error` to subscribers (TUI, web)

**Reference:** Inspired by opencode's Bus + Plugin systems.

### 5. Dual Storage: SQLite + JSON (NEW in v3)

**Decision:** Primary storage in SQLite for structured queries; JSON fallback for simplicity or when SQLite unavailable.

**Rationale:**

- SQLite: Efficient for large sessions, supports joins, indexes
- JSON: Simple, portable, no database setup required

**Reference:** Inspired by opencode's storage layer.

### 6. Plugin Architecture (NEW in v3)

**Decision:** Skills can be extended to plugins that also provide tools, hooks, and MCP servers.

**Rationale:** Extensibility beyond just instruction injection. Plugins can add arbitrary tools and integrate with external systems.

**Reference:** Inspired by opencode's plugin system.

### 7. Provider-Specific Prompts (NEW in v3)

**Decision:** Separate prompt templates per LLM provider (anthropic, openai, gemini, etc.).

**Rationale:** Different models require different prompt formats (XML tags for Claude, function calling syntax for OpenAI, etc.).

**Reference:** Inspired by opencode's `session/prompt/` directory.

### 8. Event Sourcing with Aggregates (NEW in v3)

**Decision:** Rollout events are typed with aggregateID and sequence numbers.

**Rationale:** Enables proper replay, debugging, and analytics with ordering guarantees.

**Reference:** Inspired by opencode's SyncEvent system.

### 9. Zod Config Validation (NEW in v3)

**Decision:** Config files validated with Zod at runtime.

**Rationale:** Catch configuration errors early with descriptive messages.

**Reference:** Inspired by opencode's Effect/Schema validation.

### 10. VCS-Aware Bootstrap (NEW in v3)

**Decision:** Project initialization detects git worktree, branch, remote, dirty state.

**Rationale:** Better context for the agent — knows if it's in a worktree, can identify remote repo.

**Reference:** Inspired by opencode's project bootstrap.

### 11. Structured Error Types (NEW in v3)

**Decision:** Errors are typed with `NamedError.create()` factory.

**Rationale:** Structured error data enables better error handling, debugging, and recovery.

**Reference:** Inspired by opencode's NamedError pattern.

### 12. Web App as Thin Client (NEW in v4)

**Decision:** `apps/web` is a pure UI shell like TUI and VSCode, not a separate backend.

**Rationale:** Consistency across all frontends. Session state lives in CLI (and Thread Store).

---

## Deferred Items (v1 → v4 Status)

| Item                      | v1 Status | v2 Status     | v3 Status                 | v4 Status     | Notes                      |
| ------------------------- | --------- | ------------- | ------------------------- | ------------- | -------------------------- |
| MCP server integration    | Deferred  | Planned       | **Implemented**           | Planned       | Spec only, not implemented |
| Storage layer             | Deferred  | Planned       | **Implemented**           | Planned       | Spec only, not implemented |
| Sub-agent implementation  | Deferred  | Planned       | **Expanded**              | Planned       | Spec only, not implemented |
| Memory compaction         | Deferred  | Planned       | **Implemented**           | Planned       | Spec only, not implemented |
| Hook middleware           | Basic (2) | Expanded (10) | **Expanded + Refactored** | Planned       | Spec only, not implemented |
| Rust TUI                  | Deferred  | Deferred      | Deferred                  | Deferred      | Still deferred             |
| Effect/Layer DI           | None      | None          | **New in v3**             | Planned       | Spec only, not implemented |
| Plugin architecture       | None      | None          | **New in v3**             | Planned       | Spec only, not implemented |
| Event sourcing            | None      | Basic         | **New in v3**             | Planned       | Spec only, not implemented |
| Provider prompts          | None      | None          | **New in v3**             | Planned       | Spec only, not implemented |
| Config validation         | None      | None          | **New in v3**             | Planned       | Spec only, not implemented |
| VCS awareness             | None      | None          | **New in v3**             | Planned       | Spec only, not implemented |
| Structured errors         | None      | None          | **New in v3**             | Planned       | Spec only, not implemented |
| Auto skill discovery      | None      | None          | **New in v3**             | Planned       | Spec only, not implemented |
| MCP polling               | None      | None          | **New in v3**             | Planned       | Spec only, not implemented |
| Observability             | None      | None          | None                      | **New in v4** | Planned                    |
| Multi-agent orchestration | None      | None          | None                      | **New in v4** | Planned                    |
| Web as thin client        | None      | None          | None                      | **New in v4** | Clarified                  |

---

## Design Pattern Origins

Every pattern in FreeCode v4 has roots in familiar systems:

| FreeCode Pattern    | Analogous System                | Why It Matters                                 |
| ------------------- | ------------------------------- | ---------------------------------------------- |
| Agent loop          | Worker processing a task queue  | Model drives workflow decisions                |
| Tools               | Service interface layer         | Separation of thinking vs doing                |
| Hooks (10 types)    | Web middleware + event sourcing | Safety + observability + lifecycle             |
| Bus (PubSub)        | Message queue / event bus       | Decoupled event distribution                   |
| Memory compaction   | Log rotation                    | Handles unbounded session length               |
| Sub-agents          | Worker nodes / map-reduce       | Parallel distributed processing                |
| Skills              | Reusable scripts / templates    | Pre-packaged behaviors with implicit detection |
| Plugins             | OS plugins / browser extensions | Arbitrary code injection + tools               |
| Rollout events      | Event sourcing / audit log      | Debugging, replay, analytics                   |
| Thread Store        | Persistent queue                | Sessions survive restarts                      |
| MCP integration     | Plugin architecture             | Interoperability with other AI tools           |
| Permission profiles | Capability-based security       | Granular sandbox control                       |
| Effect/Layers       | Dependency injection containers | Testable, composable services                  |
| Provider prompts    | Template method pattern         | Model-specific formatting                      |
| Named errors        | Tagged union errors             | Structured error data                          |
| Zod validation      | Schema validation               | Runtime type safety                            |
| Observability       | APM / distributed tracing       | Debugging production issues                    |

---

## Success Criteria (Architecture v4)

- [ ] Everything from v3 success criteria
- [ ] Web app is a thin client like TUI/VSCode
- [ ] CLI exposes HTTP endpoint (in addition to stdio) for web app
- [ ] Multi-agent orchestration patterns documented
- [ ] Implicit skill detection for automatic skill invocation
- [ ] Observability section (logging + tracing) added
- [ ] **Implementation gap documented** — clear what's spec vs reality
- [ ] `packages/shared` created with shared types
- [ ] Effect/Layer architecture composes all CLI services
- [ ] Bus publishes session events to all frontends
- [ ] Hooks intercept tool calls (10 event types) independently of Bus
- [ ] Skills system auto-discovers `**/*.skill.md` via glob patterns
- [ ] Plugins can provide tools, hooks, and MCP server definitions
- [ ] Rollout events written with aggregateID and seq for replay
- [ ] ThreadStore persists sessions to SQLite (with JSON fallback)
- [ ] Session fork works with message hierarchy preservation
- [ ] Provider-specific prompts loaded per LLM (anthropic.txt, openai.txt, etc.)
- [ ] Config validated with Zod schemas at startup
- [ ] Project bootstrap detects git worktree, branch, remote
- [ ] NamedError factory creates typed error classes
- [ ] MCP server supports stdio + streamable-http transports
- [ ] MCP OAuth provider handles remote server authentication
- [ ] MCPToolsChanged event published when server tools change
- [ ] Windows (win32) Ctrl+C handler + processed input mode
- [ ] ReasoningPart, SnapshotPart, PatchPart supported in message parts
- [ ] Structured logger with service + span context
- [ ] Session replay from rollout events for debugging

---

## Migration Priority

Given the gap between spec and implementation, recommend this priority:

1. **Phase 1: Foundation** — `packages/shared`, `apps/core/src/server.ts` expand methods, basic IPC
2. **Phase 2: Core missing** — Effect/Layer, Hooks, Bus, Tools (bash, edit, grep, etc.)
3. **Phase 3: Storage** — Thread Store, Rollout/Event sourcing
4. **Phase 4: Advanced** — Skills system, MCP, Sub-agents, Multi-agent orchestration
5. **Phase 5: Polish** — Observability, Provider prompts, Config validation

See `2026-05-24-architecture-migration.md` for detailed migration steps.
