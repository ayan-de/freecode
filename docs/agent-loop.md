# Agent Loop Implementation

> The core execution engine that drives the agent's behavior through a continuous cycle of thought-action-observation.

> **TUI Framework**: For TUI components and customization, see [`pi-tui.md`](../pi-tui.md).

## Overview

The agent loop is a continuous cycle that processes user prompts, executes tools, manages memory, and handles recovery. It follows a two-phase context collection approach before each model invocation.

```
┌─────────────────────────────────────────────────────────────────┐
│                        Agent Loop                                │
│                                                                  │
│  ┌─────────┐   ┌─────────┐   ┌─────────┐   ┌─────────┐          │
│  │  Start  │──▶│ Collect │──▶│  Send   │──▶│Execute  │          │
│  │ Session │   │ Context │   │  to LLM │   │  Tools  │          │
│  └─────────┘   └─────────┘   └─────────┘   └────┬────┘          │
│       │                                            │              │
│       │              ┌────────────────────────────┘              │
│       │              ▼                                           │
│       │         ┌─────────┐                                      │
│       │         │  Loop   │◀──────────────┐                      │
│       │         │  Health │               │                      │
│       │         │  Check  │               │                      │
│       │         └─────────┘               │                      │
│       │              │                    │                      │
│       │              ▼                    │                      │
│       │         ┌─────────┐   No          │                      │
│       └────────▶│  Stop   │◀──────────────┘                      │
│                 └─────────┘         Yes                          │
└─────────────────────────────────────────────────────────────────┘
```

## File Structure

```
src/agent/
├── loop.ts          # Main AgentLoop class
├── types.ts         # Type definitions (ToolCall, ToolResult, etc.)
├── recorder.ts      # Event recording for replay
├── health.ts        # Loop health heuristics
└── index.ts         # Public exports
```

## Two-Phase Context Collection

Before sending a prompt to the LLM, the loop uses a two-phase approach:

### Phase 1: File Discovery

```
User Prompt + File Tree → LLM → List of needed files
```

### Phase 2: Full Execution

```
Files + User Prompt → LLM → Tool Calls → Execute → Results → Loop
```

This is more efficient than sending all project files upfront.

## Core Cycle

### 1. Session Initialization

```typescript
await this.hooks.runSessionStart({ sessionId, turnCount });

// Collect project context (name, path, tree)
const contextResult = await this.collectContext(projectPath);
```

### 2. Continuous Loop

```typescript
while (this.state.status === "running") {
  // Check max iterations
  if (this.state.iterationCount >= this.config.maxIterations) {
    await this.stop("max_iterations_reached");
    break;
  }

  // Check loop health
  const healthAction = this.evaluateLoopHealth();
  if (healthAction.action === "stop") {
    await this.stop(healthAction.reason || "loop_health_stop");
    break;
  }

  // Execute one turn
  await this.executeTurn(input);
}
```

### 3. Turn Execution (`executeTurn`)

```typescript
async executeTurn(input: UserInput): Promise<ToolResults> {
  // Phase 1: Ask which files needed
  const neededFiles = await this.askWhichFiles(prompt, context)

  // Phase 2: Read those files
  const fileContents = await this.readFiles(neededFiles)

  // Build full prompt with context
  const fullPrompt = this.buildPrompt(prompt, fileContents, context)

  // UserPromptSubmit Hook — can modify prompt
  const hookResult = await this.hooks.runUserPromptSubmit(fullPrompt, ctx)
  const modifiedPrompt = hookResult.modifiedPrompt ?? fullPrompt

  // Send to LLM
  const providerResult = await this.sendToProvider(modifiedPrompt, ...)

  // Extract tool calls
  let toolCalls = providerResult.toolCalls ?? []
  if (toolCalls.length === 0) {
    toolCalls = this.parseResponse(this.normalizeResponse(...))
  }

  // No tools? Return early
  if (toolCalls.length === 0) {
    this.memory.addMessage("user", prompt)
    this.memory.addMessage("assistant", providerResult.content)
    return { success: true, toolResults: [], responseText: ... }
  }

  // Execute tools sequentially
  for (const toolCall of toolCalls) {
    const result = await this.executeTool(toolCall)
    toolResults.push(result)
    this.updateLoopHealth(toolCall, result)
  }

  // Check memory compaction
  if (this.memory.shouldCompact(provider)) {
    const preResult = await this.hooks.runPreCompact(ctx)
    if (preResult.allowed) {
      await this.memory.compact()
      await this.hooks.runPostCompact(ctx, success)
    }
  }

  return { success: true, toolResults, responseText: ... }
}
```

## Tool Execution (`executeTool`)

```typescript
async executeTool(toolCall: ToolCall): Promise<ToolResult> {
  const hookContext = { sessionId, turnCount, toolName }

  // PreToolUse Hook — can block or modify
  const preResult = await this.hooks.runPreToolUse(toolCall, hookContext)
  if (!preResult.allowed) {
    return { error: `Blocked by hook: ${preResult.blockReason}` }
  }

  // Apply input modifications
  if (preResult.modifiedInput) {
    toolCall = { ...toolCall, args: { ...toolCall.args, ...preResult.modifiedInput } }
  }

  // PermissionRequest Hook — for dangerous operations
  const permResult = await this.hooks.runPermissionRequest(toolCall, hookContext)
  if (permResult.decision === "deny") {
    return { error: `Permission denied: ${permResult.reason}` }
  }

  // Execute with error handling
  let result: ToolResult
  try {
    result = await orchestrator.execute(toolCall, context)
  } catch (error) {
    // PostToolUseFailure Hook
    await this.hooks.runPostToolUseFailure(toolCall, String(error), hookContext)
    return { error: String(error) }
  }

  // PostToolUse Hook — can modify result
  const postResult = await this.hooks.runPostToolUse(toolCall, result, hookContext)

  return result
}
```

## Hook Integration Points

| Point                 | Hook                 | Purpose                                |
| --------------------- | -------------------- | -------------------------------------- |
| Session start         | `SessionStart`       | Initialize session state, load context |
| Before prompt         | `UserPromptSubmit`   | Modify prompt, inject context          |
| Before tool           | `PreToolUse`         | Block/modify tool call                 |
| Before dangerous tool | `PermissionRequest`  | Request user approval                  |
| After tool success    | `PostToolUse`        | Process results, inject context        |
| After tool failure    | `PostToolUseFailure` | Error handling, recovery               |
| Before compaction     | `PreCompact`         | Inspect/block compaction               |
| After compaction      | `PostCompact`        | Verify/log compaction                  |
| Session end           | `Stop`               | Cleanup, final logging                 |

## Loop Health

The loop health system detects stuck patterns:

```typescript
interface LoopHealth {
  repeatedTools: number; // Same tool+args repeated
  stagnantTurns: number; // No progress made
  oscillationScore: number; // Edit/revert/edit pattern
  repeatedReasoningScore: number; // Similar reasoning repeated
}
```

### Heuristics

| Check                | Threshold        | Action    |
| -------------------- | ---------------- | --------- |
| Identical tool call  | 3x               | Hard stop |
| No state change      | 5 turns          | Warning   |
| Edit oscillation     | 4x               | Block     |
| Reasoning similarity | >90% for 3 turns | Block     |
| Total iterations     | 100              | Hard stop |

## Memory Management

Memory accumulates conversation history and periodically compacts when token limit approaches:

```typescript
if (this.memory.shouldCompact(provider)) {
  const preResult = await this.hooks.runPreCompact(ctx);
  if (preResult.allowed) {
    const result = await this.memory.compact();
    await this.hooks.runPostCompact(ctx, result.success);
  }
}
```

## Error Handling

### Recovery Policies

```typescript
interface RecoveryPolicy {
  canRecover(error: unknown): boolean;
  strategy:
    | "retry"
    | "restart-provider"
    | "restart-browser"
    | "rollback-turn"
    | "abort-session";
  maxAttempts: number;
  initialDelay?: number;
  backoff?: "linear" | "exponential" | "fixed";
}
```

### Error Flow

1. Tool throws → catch in executeTool → call PostToolUseFailure
2. Recovery policy checks if recoverable
3. If yes, retry with backoff
4. If no, fail the turn and report error

## Event Recording

Events are recorded for replay and debugging:

```typescript
this.recorder.recordTurnStarted(`turn-${this.state.turnCount}`);
this.recorder.recordFunctionCall(
  toolName,
  args,
  `turn-${this.state.turnCount}`,
);
this.recorder.recordFunctionOutput(toolName, output, duration);
this.recorder.recordHookBlocked(toolName, reason);
```

## Bus Events

Events published to the bus for UI/extension consumption:

```typescript
BusEvents.sessionCreated(sessionId, projectPath);
BusEvents.sessionUpdated(sessionId);
BusEvents.sessionError(sessionId, error);
BusEvents.turnStarted(sessionId, turnCount);
BusEvents.turnCompleted(sessionId, turnCount);
BusEvents.toolCalled(sessionId, toolName, toolId, args);
BusEvents.toolCompleted(sessionId, toolName, toolId, success, duration_ms);
BusEvents.subagentStarted(subagentId, parentSessionId, task);
BusEvents.subagentCompleted(subagentId, parentSessionId, result);
```

## Key Types

```typescript
interface ToolCall {
  id: string;
  tool: string; // Tool name (Write, Bash, etc.)
  args: unknown; // Tool arguments
  execution: ExecutionMode; // "sequential" | "parallel-safe"
}

interface ToolResult {
  id: string;
  toolCallId: string;
  tool: string;
  title: string;
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  duration_ms?: number;
  error?: string;
}

interface HookContext {
  sessionId: string;
  turnCount: number;
  toolName?: string;
  [key: string]: unknown;
}
```

## Configuration

```typescript
interface AgentConfig {
  maxIterations: number; // Default: 100
  maxTokensPerTurn?: number;
  temperature?: number;
  compactionConfig?: CompactionConfig;
  hooks?: HookRuntime;
}
```

## Session State Machine

```
     ┌─────────┐
     │  idle   │
     └────┬────┘
          │ run()
          ▼
     ┌──────────┐
     │ starting │
     └────┬─────┘
          │ session created
          ▼
     ┌──────────┐
     │ running  │◄──── loop
     └────┬─────┘
          │ stop() / error / max_iterations
          ▼
     ┌──────────┐
     │ stopped  │
     └──────────┘
```

## Extension Points

1. **Custom Tools** — Add to `orchestrator` registry
2. **Hook Handlers** — Register via `registerHook()`
3. **Recovery Policies** — Implement custom recovery logic
4. **Memory Strategies** — Implement custom compaction
5. **Provider Adapters** — Implement new AI providers
