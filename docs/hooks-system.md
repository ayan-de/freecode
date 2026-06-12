# Hooks System

> Interception points for modifying agent behavior at key lifecycle points.

## Overview

The hooks system provides a way to intercept, modify, and respond to events during the agent's execution lifecycle. Hooks are the primary extension point for customizing agent behavior without modifying core loop logic.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Agent Loop                                │
│                                                                  │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐   │
│  │ Session  │───▶│  User    │───▶│  Pre     │───▶│  Tool    │   │
│  │ Start    │    │  Prompt  │    │  Tool    │    │  Use     │   │
│  └──────────┘    │  Submit  │    └──────────┘    └──────────┘   │
│                   └──────────┘                                   │
│                       │                    │                     │
│                       ▼                    ▼                     │
│               ┌──────────┐    ┌──────────┐    ┌──────────┐       │
│               │  Post    │◀───│Permis-   │◀───│  Pre    │       │
│               │  Tool    │    │  sion    │    │  Compact │       │
│               │  Use     │    │Request   │    └──────────┘       │
│               └──────────┘    └──────────┘           │            │
│                       │                    ▼                     │
│                       │            ┌──────────┐                  │
│                       └───────────▶│  Post   │◀─┐               │
│                                   │Compact  │  │               │
│                                   └──────────┘  │               │
│                                          ▲      │               │
└──────────────────────────────────────────┼──────┼───────────────┘
                                           │      │
                                   ┌───────┴──────┴───────┐
                                   │   Subagent Start     │
                                   │        /             │
                                   │   Subagent Stop      │
                                   └──────────────────────┘
                                           │
                                           ▼
                                   ┌──────────────┐
                                   │     Stop     │
                                   └──────────────┘
```

## 10 Hook Event Types

| Event               | Purpose                                    | Can Block | Can Modify |
| ------------------- | ------------------------------------------ | --------- | ---------- |
| `SessionStart`      | Initialize session state                   | No        | Yes        |
| `UserPromptSubmit`  | Modify prompt before sending to model      | No        | Yes        |
| `PreToolUse`        | Validate/modify tool call before execution | Yes       | Yes        |
| `PermissionRequest` | Request user approval for risky operations | Yes       | Yes        |
| `PostToolUse`       | Process tool results, inject context       | No        | Yes        |
| `PreCompact`        | Inspect/modify context before compaction   | Yes       | No         |
| `PostCompact`       | Verify/log compaction results              | No        | Yes        |
| `SubagentStart`     | Initialize subagent context                | No        | Yes        |
| `SubagentStop`      | Collect results from subagent              | No        | Yes        |
| `Stop`              | Cleanup on agent termination               | No        | No         |

## Usage

### Registering Hooks

```typescript
import { registerHook, getHookRuntime } from "./hooks";

// Register a command hook
registerHook("PreToolUse", "my-hook", {
  type: "command",
  command: "echo 'Blocking Write' && exit 2", // Exit 2 = block
  matcher: "Write",
});

// Register a callback hook
registerHook("PostToolUse", "log-tool", {
  type: "callback",
  callback: async (input, context) => {
    console.log(`Tool ${input.toolName} executed`);
    return { action: "continue" };
  },
});
```

### Using Hooks in Code

```typescript
import { getHookRuntime } from "./hooks";

const hooks = getHookRuntime();

// Before tool execution
const preResult = await hooks.runPreToolUse(toolCall, {
  sessionId: "sess-123",
  turnCount: 1,
  toolName: toolCall.tool,
});

if (!preResult.allowed) {
  // Tool was blocked by hook
  console.log(`Blocked: ${preResult.blockReason}`);
}

// After tool execution
const postResult = await hooks.runPostToolUse(toolCall, result, {
  sessionId: "sess-123",
  turnCount: 1,
  toolName: toolCall.tool,
});
```

## Hook Command Types

### Command Hook

Executes a shell command when the hook triggers.

```typescript
registerHook("PreToolUse", "block-dangerous", {
  type: "command",
  command: "./check-permissions.sh",
  shell: "bash",
  timeout: 5000,
});
```

**Environment Variables Passed:**

- `CLAUDE_SESSION_ID` - Current session ID
- `CLAUDE_CWD` - Current working directory
- `CLAUDE_TOOL_NAME` - Name of the tool being executed
- `CLAUDE_TOOL_INPUT` - JSON string of tool input
- `CLAUDE_AGENT_ID` - Agent ID (if applicable)
- `CLAUDE_AGENT_TYPE` - Agent type (if applicable)

**Exit Codes:**

- `0` - Continue execution
- `2` - Block execution (output is the reason)

**JSON Output Protocol:**

```json
{
  "block": true,
  "reason": "User rejected this operation",
  "modifiedInput": { "file": "new-path.txt" },
  "context": "Additional context to inject"
}
```

### Callback Hook

Executes an internal function when the hook triggers.

```typescript
registerHook("PreToolUse", "validate-input", {
  type: "callback",
  callback: async (input, context) => {
    if (input.toolName === "Bash" && input.toolInput.command.includes("rm")) {
      return { action: "block", reason: "No rm commands allowed" };
    }
    return { action: "continue" };
  },
});
```

**Callback Actions:**

- `{ action: "continue" }` - Proceed normally
- `{ action: "block", reason: string }` - Block and return reason
- `{ action: "modify", modifiedInput?: object, modifiedOutput?: object }` - Modify and continue

### Prompt Hook

Uses an LLM to evaluate whether to proceed (not yet implemented).

```typescript
registerHook("PreToolUse", "llm-approval", {
  type: "prompt",
  prompt: "Should I allow this operation?",
  model: "claude",
});
```

## Hook Matcher Patterns

Hooks can use pattern matching to only trigger for specific tools:

```typescript
// Match any tool
matcher: "*";

// Match specific tool
matcher: "Write";

// Match tools with pattern
matcher: "Bash(git *)";

// Match multiple alternatives (pipe-separated)
matcher: "Write|Edit";

// Complex patterns
matcher: "Bash(npm * | yarn * | pnpm *)";
```

## Integration Points

### In Agent Loop (`agent/loop.ts`)

```typescript
// Session Start
await this.hooks.runSessionStart(ctx);

// User Prompt Submit (can modify prompt)
const result = await this.hooks.runUserPromptSubmit(prompt, ctx);
const modifiedPrompt = result.modifiedPrompt ?? prompt;

// Pre Tool Use (can block or modify)
const preResult = await this.hooks.runPreToolUse(toolCall, ctx);
if (!preResult.allowed) {
  /* blocked */
}
if (preResult.modifiedInput) {
  /* apply modifications */
}

// Permission Request (for dangerous operations)
const permResult = await this.hooks.runPermissionRequest(toolCall, ctx);

// Post Tool Use (can modify output)
const postResult = await this.hooks.runPostToolUse(toolCall, result, ctx);

// Pre/Post Compact (memory compaction)
const preResult = await this.hooks.runPreCompact(ctx);
await this.hooks.runPostCompact(ctx, success);

// Subagent lifecycle
await this.hooks.runSubagentStart(name, ctx);
await this.hooks.runSubagentStop(name, ctx);

// Stop (cleanup)
await this.hooks.runStop(reason, ctx);
```

## Event Bus Integration

Hooks publish events to the bus when triggered:

```typescript
// Hook triggered
bus.publish({ type: "hook.triggered", hookName, event, sessionId });

// Hook blocked
bus.publish({ type: "hook.blocked", hookName, event, sessionId, reason });
```

## HookContext Type

```typescript
interface HookContext {
  sessionId: string; // Current session ID
  turnCount: number; // Current turn number
  toolName?: string; // Tool name (for tool hooks)
  [key: string]: unknown; // Additional context
}
```

## Type Definitions

### HookExecutionResult

```typescript
type HookExecutionResult =
  | {
      success: true;
      modifiedInput?: object;
      modifiedOutput?: unknown;
      additionalContext?: string;
    }
  | { success: false; blocked: true; blockReason?: string }
  | { success: false; blocked: false; error: string };
```

### HookResult (Callback)

```typescript
type HookResult =
  | { action: "continue" }
  | { action: "block"; reason: string }
  | { action: "modify"; modifiedInput?: object; modifiedOutput?: unknown };
```

## File Structure

```
src/hooks/
├── index.ts                 # Public API exports
├── runtime.ts               # HookRuntime interface + implementation
├── registry.ts              # Hook registration + matching
├── types.ts                 # Type definitions
├── executors/
│   ├── index.ts             # Coordinator - executes hooks
│   ├── command.ts           # Shell command execution
│   └── callback.ts          # Callback function execution
├── PreToolUse.ts            # Pre-tool hooks
├── PostToolUse.ts           # Post-tool hooks
├── PermissionRequest.ts     # Permission hooks
├── PreCompact.ts            # Pre-compaction hooks
├── PostCompact.ts           # Post-compaction hooks
├── SessionStart.ts          # Session start hooks
├── UserPromptSubmit.ts      # User prompt hooks
├── SubagentStart.ts         # Subagent start hooks
├── SubagentStop.ts          # Subagent stop hooks
└── Stop.ts                  # Stop hooks
```
