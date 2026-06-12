# Tool Progress Streaming Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Display live tool progress in TUI when agent uses tools (Read, Write, Bash, etc.)

**Architecture:** CLI streams JSON events (tool_start/tool_output/tool_complete) to TUI as tools execute. TUI parses events and renders tool progress components with live output.

**Tech Stack:** TypeScript, pi-tui components, JSON-RPC over stdin/stdout

---

## File Structure

```
packages/shared/src/ipc/protocol.ts     - Add StreamEvent types
apps/core/src/agent/types.ts           - Add onToolEvent to RunOptions
apps/core/src/agent/loop.ts            - Emit tool events during execution
apps/core/src/server.ts                - Stream events to stdout during session.send
apps/tui/src/ipc/client.ts             - Add sessionSendStreaming with event parsing
apps/tui/src/state/message-store.ts    - Add tool message state management
apps/tui/src/components/tool-progress-message.ts  - NEW: in-progress display
apps/tui/src/components/tool-result-message.ts    - NEW: completed/error display
apps/tui/src/components/index.ts      - Export new components
apps/tui/src/index.ts                  - Wire streaming into message flow
```

---

## Task 1: Add StreamEvent Types to Protocol

**Files:**

- Modify: `packages/shared/src/ipc/protocol.ts`

- [ ] **Step 1: Add StreamEvent union type**

```typescript
// Add after existing StreamResponse type (around line 28)

export type StreamEvent =
  | {
      type: "tool_start";
      toolCallId: string;
      toolName: string;
      args: Record<string, unknown>;
    }
  | { type: "tool_output"; toolCallId: string; content: string }
  | {
      type: "tool_complete";
      toolCallId: string;
      toolName: string;
      result: string;
      success: boolean;
      duration_ms?: number;
    }
  | { type: "text"; content: string }
  | { type: "done"; content: string }
  | { type: "error"; content: string };
```

- [ ] **Step 2: Verify types compile**

Run: `cd /home/ayande/Project/freecode && npx tsc --noEmit -p packages/shared/tsconfig.json`
Expected: No errors

---

## Task 2: Add onToolEvent Callback to AgentLoop

**Files:**

- Modify: `apps/core/src/agent/types.ts:174-180` (UserInput interface area)
- Modify: `apps/core/src/agent/loop.ts:68` (run method signature)

- [ ] **Step 1: Add onToolEvent to UserInput type**

Find the UserInput interface (around line 174) and add:

```typescript
export interface UserInput {
  prompt: string;
  sessionId: string;
  provider: string;
  model?: string;
  projectPath: string;
  onToolEvent?: (event: StreamEvent) => void; // NEW
}
```

- [ ] **Step 2: Modify AgentLoop.run() to accept and pass onToolEvent**

In `loop.ts` line 68, modify:

```typescript
async run(input: UserInput): Promise<LoopResult> {
  // ... existing code ...
  // Pass onToolEvent to executeTool
}
```

Add a class property to store onToolEvent:

```typescript
private onToolEvent: ((event: StreamEvent) => void) | undefined;

constructor(sessionId: string, config?: ...) {
  // ... existing constructor code ...
}

async run(input: UserInput): Promise<LoopResult> {
  this.onToolEvent = input.onToolEvent;  // NEW - store callback
  // ... rest of run method
}
```

- [ ] **Step 3: Update executeTool to emit tool_start event**

In `loop.ts` around line 499 (`executeTool` method), add tool_start emission after the PreToolUse hook check and before tool execution:

```typescript
private async executeTool(toolCall: ToolCall): Promise<ToolResult> {
  const startTime = Date.now()

  // ... existing hooks code (lines 503-556) ...

  // Emit tool_start event BEFORE execution
  this.onToolEvent?.({
    type: "tool_start",
    toolCallId: toolCall.id,
    toolName: toolCall.tool,
    args: toolCall.args as Record<string, unknown>,
  });

  // ... rest of executeTool (line 558 onwards) ...
}
```

- [ ] **Step 4: Emit tool_output events from BashTool**

For the Bash tool, we need to capture output as it happens. Add output buffering in the orchestrator or tool execution. For simplicity, emit `tool_output` when tool has meaningful progress.

In `loop.ts` around line 564-596, after tool execution and before the post hook:

```typescript
// After result is available (after line 569)
if (result.stdout) {
  // Emit stdout as tool_output
  const outputLines = result.stdout.split("\n").slice(-5).join("\n"); // last 5 lines
  this.onToolEvent?.({
    type: "tool_output",
    toolCallId: toolCall.id,
    content: outputLines,
  });
}
```

- [ ] **Step 5: Emit tool_complete event after result**

In `loop.ts` around line 596-600, after `BusEvents.toolCompleted`:

```typescript
// Emit tool_complete event
this.onToolEvent?.({
  type: "tool_complete",
  toolCallId: toolCall.id,
  toolName: toolCall.tool,
  result: result.stdout || result.error || "",
  success: !result.error,
  duration_ms: Date.now() - startTime,
});
```

- [ ] **Step 6: Verify types compile**

Run: `cd /home/ayande/Project/freecode && npx tsc --noEmit -p apps/core/tsconfig.json`
Expected: No errors

---

## Task 3: Modify CLI Server to Stream Events

**Files:**

- Modify: `apps/core/src/server.ts:102-131`

- [ ] **Step 1: Update session.send to stream events**

In `server.ts`, modify the `session.send` handler (lines 102-131) to stream events:

```typescript
"session.send": async (params: Record<string, unknown>): Promise<unknown> => {
  const { sessionId, message, model } = params as { sessionId: string; message: string; model?: string };
  const session = getSession(sessionId);

  if (!session) {
    throw new Error(`Session not found: ${sessionId}`);
  }

  const config = readConfig()
  const currentProvider = config.current?.provider || session.provider

  if (model) {
    session.model = model;
  }

  // Emit events to stdout immediately for streaming
  const emitEvent = (event: StreamEvent) => {
    process.stdout.write(JSON.stringify(event) + "\n");
  };

  const loop = createAgentLoop(sessionId, { maxIterations: 100 })
  const result = await loop.run({
    prompt: message,
    sessionId,
    provider: currentProvider,
    model: session.model,
    projectPath: session.projectPath,
    onToolEvent: emitEvent,  // NEW: pass emit function
  })

  // Emit done event
  emitEvent({ type: "done", content: result.message || "Done" });

  return result;
},
```

- [ ] **Step 2: Verify server compiles**

Run: `cd /home/ayande/Project/freecode && npx tsc --noEmit -p apps/core/tsconfig.json`
Expected: No errors

---

## Task 4: Add sessionSendStreaming to TUI IPC Client

**Files:**

- Modify: `apps/tui/src/ipc/client.ts`

- [ ] **Step 1: Add StreamEvent import**

At the top of `client.ts`, add import:

```typescript
import type { StreamEvent } from "@freecode/shared";
```

- [ ] **Step 2: Add sessionSendStreaming function**

After the existing `sessionSend` function (around line 163), add:

```typescript
export async function sessionSendStreaming(
  sessionId: string,
  message: string,
  model: string | undefined,
  onEvent: (event: StreamEvent) => void,
): Promise<SessionSendResult> {
  return new Promise((resolve, reject) => {
    if (!cliProcess || !cliProcess.stdin) {
      reject(new Error("CLI not running"));
      return;
    }

    const id = generateId();
    const request: JsonRpcRequest = {
      jsonrpc: "2.0",
      id,
      method: "session.send",
      params: { sessionId, message, model },
    };

    // Buffer for parsing streaming events
    let eventBuffer = "";

    // Set up temporary handler for streaming responses
    const originalHandler = cliProcess.stdout?.on;
    const handleData = (data: string) => {
      eventBuffer += data;
      const lines = eventBuffer.split("\n");

      for (let i = 0; i < lines.length - 1; i++) {
        const line = lines[i];
        if (!line.trim()) continue;

        // Check if this is a StreamEvent (not JSON-RPC response)
        if (line.startsWith("{")) {
          try {
            const parsed = JSON.parse(line);
            // If it has type field and no jsonrpc, it's a StreamEvent
            if (parsed.type && !parsed.jsonrpc) {
              onEvent(parsed as StreamEvent);
              continue;
            }
            // If it has jsonrpc, it's a response - handle it
            if (parsed.jsonrpc) {
              pendingRequests.delete(parsed.id);
              if (parsed.error) {
                reject(new Error(parsed.error.message));
              } else {
                resolve(parsed.result as SessionSendResult);
              }
            }
          } catch {
            // Not JSON, skip
          }
        }
      }

      // Keep unparsed remainder
      eventBuffer = lines[lines.length - 1] || "";
    };

    // Send request
    pendingRequests.set(id, {
      resolve: resolve as (value: unknown) => void,
      reject,
    });
    cliProcess.stdin.write(JSON.stringify(request) + "\n");
  });
}
```

- [ ] **Step 3: Verify client compiles**

Run: `cd /home/ayande/Project/freecode && npx tsc --noEmit -p apps/tui/tsconfig.json`
Expected: No errors

---

## Task 5: Add Tool Message State to Message Store

**Files:**

- Modify: `apps/tui/src/state/message-store.ts`

- [ ] **Step 1: Add ToolMessage interface and methods**

Add at the end of the file, before the exports:

```typescript
export interface ToolMessage {
  id: number;
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
  status: "pending" | "running" | "complete" | "error";
  outputLines: string[];
  result?: string;
  success?: boolean;
  duration_ms?: number;
  timestamp: number;
  component?: Component;
}

class MessageStoreImpl {
  // ... existing code ...

  // NEW: Tool message tracking
  private toolMessages = new Map<string, ToolMessage>();

  addToolMessage(
    toolCallId: string,
    toolName: string,
    args: Record<string, unknown>,
  ): ToolMessage {
    const id = this.generateId();
    const toolMsg: ToolMessage = {
      id,
      toolCallId,
      toolName,
      args,
      status: "pending",
      outputLines: [],
      timestamp: Date.now(),
    };
    this.toolMessages.set(toolCallId, toolMsg);
    this.notify();
    return toolMsg;
  }

  updateToolStatus(
    toolCallId: string,
    status: ToolMessage["status"],
    updates?: Partial<ToolMessage>,
  ): void {
    const toolMsg = this.toolMessages.get(toolCallId);
    if (toolMsg) {
      toolMsg.status = status;
      if (updates) {
        Object.assign(toolMsg, updates);
      }
      this.notify();
    }
  }

  appendToolOutput(toolCallId: string, content: string): void {
    const toolMsg = this.toolMessages.get(toolCallId);
    if (toolMsg) {
      // Keep last 5 lines
      const lines = content.split("\n");
      toolMsg.outputLines = lines.slice(-5);
      this.notify();
    }
  }

  getToolMessage(toolCallId: string): ToolMessage | undefined {
    return this.toolMessages.get(toolCallId);
  }

  getAllToolMessages(): ToolMessage[] {
    return Array.from(this.toolMessages.values());
  }
}

// NEW: Export helper functions
export function addToolMessage(
  toolCallId: string,
  toolName: string,
  args: Record<string, unknown>,
): ToolMessage {
  return messageStore.addToolMessage(toolCallId, toolName, args);
}

export function updateToolStatus(
  toolCallId: string,
  status: ToolMessage["status"],
  updates?: Partial<ToolMessage>,
): void {
  messageStore.updateToolStatus(toolCallId, status, updates);
}

export function appendToolOutput(toolCallId: string, content: string): void {
  messageStore.appendToolOutput(toolCallId, content);
}

export function getToolMessage(toolCallId: string): ToolMessage | undefined {
  return messageStore.getToolMessage(toolCallId);
}
```

- [ ] **Step 2: Verify message store compiles**

Run: `cd /home/ayande/Project/freecode && npx tsc --noEmit -p apps/tui/tsconfig.json`
Expected: No errors

---

## Task 6: Create ToolProgressMessage Component

**Files:**

- Create: `apps/tui/src/components/tool-progress-message.ts`

- [ ] **Step 1: Create the component**

```typescript
import { Component, TUI, Text, Box } from "@earendil-works/pi-tui";
import chalk from "chalk";

export interface ToolProgressMessageOptions {
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
  outputLines: string[];
}

// Color mapping for different tools
const TOOL_COLORS: Record<string, (text: string) => string> = {
  Read: (t) => chalk.blue(t),
  Write: (t) => chalk.green(t),
  Edit: (t) => chalk.yellow(t),
  Bash: (t) => chalk.red(t),
  Glob: (t) => chalk.cyan(t),
  Grep: (t) => chalk.magenta(t),
  Skill: (t) => chalk.white(t),
  Agent: (t) => chalk.white(t),
};

export class ToolProgressMessage implements Component {
  private toolCallId: string;
  private toolName: string;
  private args: Record<string, unknown>;
  private outputLines: string[];
  private tui?: TUI;
  private animationFrame = 0;
  private intervalId?: ReturnType<typeof setInterval>;

  constructor(options: ToolProgressMessageOptions) {
    this.toolCallId = options.toolCallId;
    this.toolName = options.toolName;
    this.args = options.args;
    this.outputLines = options.outputLines;
  }

  setTui(tui: TUI): void {
    this.tui = tui;
    // Start animation
    this.intervalId = setInterval(() => {
      this.animationFrame = (this.animationFrame + 1) % 4;
      this.tui?.requestRender();
    }, 250);
  }

  updateOutput(outputLines: string[]): void {
    this.outputLines = outputLines;
  }

  invalidate(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = undefined;
    }
  }

  render(width: number): string[] {
    const colorFn = TOOL_COLORS[this.toolName] || ((t: string) => t);
    const spinner = ["⠋", "⠙", "⠹", "⠸"][this.animationFrame];
    const argsStr = this.formatArgs();

    const lines: string[] = [];

    // Header line: [spinner] ToolName (args)
    lines.push(
      `${chalk.dim("[")}${chalk.yellow(spinner)}${chalk.dim("]")} ${colorFn(this.toolName)} ${chalk.dim("(")}${argsStr}${chalk.dim(")")}`,
    );

    // Output lines with tree view
    for (const outputLine of this.outputLines.slice(-5)) {
      lines.push(`${chalk.dim("│   ")}${chalk.dim(outputLine)}`);
    }

    return lines;
  }

  private formatArgs(): string {
    const entries = Object.entries(this.args);
    if (entries.length === 0) return "";

    // Truncate long values
    const truncate = (s: string, max = 40) =>
      s.length > max ? s.slice(0, max) + "..." : s;

    return entries
      .map(([k, v]) => {
        const vStr = typeof v === "string" ? v : JSON.stringify(v);
        return `${k}: ${chalk.green(truncate(vStr))}`;
      })
      .join(", ");
  }
}
```

- [ ] **Step 2: Verify component compiles**

Run: `cd /home/ayande/Project/freecode && npx tsc --noEmit -p apps/tui/tsconfig.json`
Expected: No errors

---

## Task 7: Create ToolResultMessage Component

**Files:**

- Create: `apps/tui/src/components/tool-result-message.ts`

- [ ] **Step 1: Create the component**

```typescript
import { Component, Text, Box } from "@earendil-works/pi-tui";
import chalk from "chalk";

export interface ToolResultMessageOptions {
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
  result?: string;
  success: boolean;
  duration_ms?: number;
}

// Color mapping for different tools
const TOOL_COLORS: Record<string, (text: string) => string> = {
  Read: (t) => chalk.blue(t),
  Write: (t) => chalk.green(t),
  Edit: (t) => chalk.yellow(t),
  Bash: (t) => chalk.red(t),
  Glob: (t) => chalk.cyan(t),
  Grep: (t) => chalk.magenta(t),
  Skill: (t) => chalk.white(t),
  Agent: (t) => chalk.white(t),
};

export class ToolResultMessage implements Component {
  private toolCallId: string;
  private toolName: string;
  private args: Record<string, unknown>;
  private result?: string;
  private success: boolean;
  private duration_ms?: number;

  constructor(options: ToolResultMessageOptions) {
    this.toolCallId = options.toolCallId;
    this.toolName = options.toolName;
    this.args = options.args;
    this.result = options.result;
    this.success = options.success;
    this.duration_ms = options.duration_ms;
  }

  invalidate(): void {
    // Nothing to clean up
  }

  render(width: number): string[] {
    const colorFn = TOOL_COLORS[this.toolName] || ((t: string) => t);
    const statusIcon = this.success ? chalk.green("✓") : chalk.red("✗");
    const argsStr = this.formatArgs();
    const duration = this.duration_ms ? `(${this.duration_ms}ms)` : "";

    const lines: string[] = [];

    // Header line: [✓/✗] ToolName (args) (duration)
    lines.push(
      `${chalk.dim("[")}${statusIcon}${chalk.dim("]")} ${colorFn(this.toolName)} ${chalk.dim("(")}${argsStr}${chalk.dim(")")} ${chalk.dim(duration)}`,
    );

    // Result with tree view character
    if (this.result) {
      const truncatedResult = this.truncateResult(this.result, 200);
      lines.push(`${chalk.dim("⎿")} ${chalk.dim(truncatedResult)}`);
    } else if (this.success) {
      lines.push(`${chalk.dim("⎿")} ${chalk.dim("(no output)")}`);
    }

    return lines;
  }

  private formatArgs(): string {
    const entries = Object.entries(this.args);
    if (entries.length === 0) return "";

    const truncate = (s: string, max = 40) =>
      s.length > max ? s.slice(0, max) + "..." : s;

    return entries
      .map(([k, v]) => {
        const vStr = typeof v === "string" ? v : JSON.stringify(v);
        return `${k}: ${chalk.green(truncate(vStr))}`;
      })
      .join(", ");
  }

  private truncateResult(result: string, maxLen: number): string {
    if (result.length <= maxLen) return result;
    return result.slice(0, maxLen) + "...";
  }
}
```

- [ ] **Step 2: Verify component compiles**

Run: `cd /home/ayande/Project/freecode && npx tsc --noEmit -p apps/tui/tsconfig.json`
Expected: No errors

---

## Task 8: Export New Components

**Files:**

- Modify: `apps/tui/src/components/index.ts`

- [ ] **Step 1: Add exports for new components**

Add to the exports:

```typescript
export {
  ToolProgressMessage,
  type ToolProgressMessageOptions,
} from "./tool-progress-message.js";
export {
  ToolResultMessage,
  type ToolResultMessageOptions,
} from "./tool-result-message.js";
```

- [ ] **Step 2: Verify exports compile**

Run: `cd /home/ayande/Project/freecode && npx tsc --noEmit -p apps/tui/tsconfig.json`
Expected: No errors

---

## Task 9: Wire Streaming into TUI index.ts

**Files:**

- Modify: `apps/tui/src/index.ts:356-402` (session.send handling)

- [ ] **Step 1: Import new components and streaming function**

Add imports at the top of index.ts:

```typescript
import {
  // ... existing imports ...
  type ToolProgressMessageOptions,
  type ToolResultMessageOptions,
} from "./components/index.js";
import {
  // ... existing imports ...
  addToolMessage,
  updateToolStatus,
  appendToolOutput,
} from "./state/message-store.js";
import { sessionSendStreaming } from "./ipc/client.js";
import type { StreamEvent } from "@freecode/shared";
import { ToolProgressMessage, ToolResultMessage } from "./components/index.js";
```

- [ ] **Step 2: Create tool message components map**

Add after the messageList initialization (around line 54):

```typescript
const toolMessageComponents = new Map<
  string,
  { progress: ToolProgressMessage; id: number }
>();
```

- [ ] **Step 3: Replace session.send with sessionSendStreaming and handle events**

In `index.ts` around line 357, replace:

```typescript
// OLD:
const result = await sessionSend(currentSession.sessionId, trimmed);

// NEW:
const result = await sessionSendStreaming(
  currentSession.sessionId,
  trimmed,
  undefined,
  (event: StreamEvent) => {
    handleToolEvent(event);
  },
);
```

- [ ] **Step 4: Add handleToolEvent function**

Add before the `editor.onSubmit` assignment (around line 289):

```typescript
function handleToolEvent(event: StreamEvent): void {
  switch (event.type) {
    case "tool_start": {
      const toolMsg = addToolMessage(
        event.toolCallId,
        event.toolName,
        event.args,
      );
      const progressComponent = new ToolProgressMessage({
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        args: event.args,
        outputLines: [],
      });
      progressComponent.setTui(tui);
      toolMessageComponents.set(event.toolCallId, {
        progress: progressComponent,
        id: toolMsg.id,
      });
      // Add to message store for rendering
      createInProgressMessage(`Running ${event.toolName}...`);
      break;
    }
    case "tool_output": {
      appendToolOutput(event.toolCallId, event.content);
      const entry = toolMessageComponents.get(event.toolCallId);
      if (entry) {
        entry.progress.updateOutput(event.content.split("\n").slice(-5));
      }
      tui.requestRender();
      break;
    }
    case "tool_complete": {
      const entry = toolMessageComponents.get(event.toolCallId);
      if (entry) {
        // Remove progress component from message store
        removeMessageById(entry.id);
        toolMessageComponents.delete(event.toolCallId);
      }
      // Create result message
      const resultComponent = new ToolResultMessage({
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        args: {},
        result: event.result,
        success: event.success,
        duration_ms: event.duration_ms,
      });
      // Add to virtual message list
      createInProgressMessage(
        event.success
          ? `${event.toolName} completed`
          : `${event.toolName} failed`,
      );
      break;
    }
  }
}
```

- [ ] **Step 5: Verify TUI compiles**

Run: `cd /home/ayande/Project/freecode && npx tsc --noEmit -p apps/tui/tsconfig.json`
Expected: No errors (may have some, debug as needed)

---

## Task 10: Test End-to-End

**Files:**

- None (testing existing code)

- [ ] **Step 1: Start TUI and verify it builds**

Run: `cd /home/ayande/Project/freecode && pnpm --filter @freecode/tui build`
Expected: Build succeeds

- [ ] **Step 2: Test tool streaming (manual test)**

Run TUI with: `pnpm --filter @freecode/tui dev`

Send a message that will trigger tool usage (e.g., "List the files in this directory" or "Read package.json")

Expected: See tool progress displayed with spinner, tool name, args, and live output

---

## Implementation Notes

1. **Event streaming uses stdout directly** - This is a simplification. Events are written directly to stdout, interleaved with the JSON-RPC response. The client parses line-by-line to distinguish events from responses.

2. **Buffer management** - The client maintains a buffer and splits on newlines, keeping any incomplete line for the next data chunk.

3. **Tool colors are hardcoded** - If you need different colors, modify `TOOL_COLORS` in each component.

4. **Last 5 lines only** - For `tool_output`, we keep only the last 5 lines to avoid memory issues with large outputs.

5. **Progress animation** - The `ToolProgressMessage` uses a simple 4-frame spinner animation. Frames: `⠋⠙⠹⠸`
