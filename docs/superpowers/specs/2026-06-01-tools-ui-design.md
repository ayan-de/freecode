# Tool Progress Streaming Design

**Date:** 2026-06-01
**Status:** Draft

## Overview

Implement streaming tool progress display in the FreeCode TUI. When the agent uses tools (Read, Write, Bash, etc.), the TUI displays live progress with tool name, parameters, and output tail - similar to Claude Code's UX.

## Architecture

```
┌─────────────┐     JSON-RPC events      ┌─────────────┐
│    CLI      │ ──────────────────────►  │    TUI      │
│  (server)   │   tool_start/output/     │  (client)   │
│             │   complete streamed       │             │
└─────────────┘   as they happen          └─────────────┘
```

## 1. Streaming Event Protocol

### New Event Types

Add to `/packages/shared/src/ipc/protocol.ts`:

```typescript
export type StreamEvent =
  | { type: "tool_start"; toolCallId: string; toolName: string; args: Record<string, unknown> }
  | { type: "tool_output"; toolCallId: string; content: string }
  | { type: "tool_complete"; toolCallId: string; toolName: string; result: string; success: boolean; duration_ms?: number }
  | { type: "text"; content: string }
  | { type: "error"; content: string };

export interface StreamResponse {
  type: "event" | "done" | "error";
  event?: StreamEvent;
  result?: unknown;
  error?: string;
}
```

### Event Flow

```
TUI → CLI: {"jsonrpc":"2.0","method":"session.send","params":{...},"id":1}
CLI → TUI: {"type":"tool_start","toolCallId":"abc","toolName":"Read","args":{"path":"/foo.txt"}}
CLI → TUI: {"type":"tool_output","toolCallId":"abc","content":"Reading..."}
CLI → TUI: {"type":"tool_output","toolCallId":"abc","content":"234 lines"}
CLI → TUI: {"type":"tool_complete","toolCallId":"abc","toolName":"Read","result":"...(truncated)...","success":true,"duration_ms":145}
CLI → TUI: {"type":"done","content":"Agent finished"}
CLI → TUI: {"jsonrpc":"2.0","result":{LoopResult},"id":1}
```

## 2. CLI Changes

### File: `apps/core/src/server.ts`

Modify `session.send` handler to stream events:

```typescript
"session.send": async (params: Record<string, unknown>, emitFn?: (event: StreamEvent) => void): Promise<unknown> => {
  const { sessionId, message, model } = params;
  // ...
  const loop = createAgentLoop(sessionId, {
    maxIterations: 100,
    onToolEvent: (event: StreamEvent) => {
      // Emit streaming event to TUI
      process.stdout.write(JSON.stringify(event) + "\n");
    }
  });
  const result = await loop.run({...});
  return result;
}
```

### File: `apps/core/src/agent/loop.ts`

Add `onToolEvent` callback to `AgentLoop.run()`:

```typescript
interface RunOptions {
  prompt: string;
  sessionId: string;
  provider: string;
  model: string;
  projectPath: string;
  onToolEvent?: (event: StreamEvent) => void;
}
```

Emit events in `executeTool()`:
- `tool_start` before executing
- `tool_output` for live output (buffer and flush periodically)
- `tool_complete` after execution finishes

## 3. TUI Changes

### IPC Client: `apps/tui/src/ipc/client.ts`

```typescript
export async function sessionSendStreaming(
  sessionId: string,
  message: string,
  model: string | undefined,
  onEvent: (event: StreamEvent) => void
): Promise<LoopResult> {
  // Send request and parse streaming events from response stream
  // For each line, check if it's a StreamEvent or final result
}
```

### State: `apps/tui/src/state/message-store.ts`

```typescript
interface ToolMessage {
  id: string;
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
  status: 'pending' | 'running' | 'complete' | 'error';
  outputLines: string[];
  result?: string;
  success?: boolean;
  duration_ms?: number;
  timestamp: number;
}

// New methods
addToolMessage(msg: ToolMessage): void
updateToolMessage(id: string, updates: Partial<ToolMessage>): void
appendToolOutput(id: string, content: string): void  // Keep last 5 lines
```

### Components: `apps/tui/src/components/`

#### `tool-progress-message.ts`

Displays a tool in progress with live output:

```typescript
export class ToolProgressMessage implements Component {
  // Shows: [●] ToolName (args)
  //        └─ output line 1
  //        └─ output line 2
  //        └─ ...
  //        └─ (last 5 lines)
}
```

#### `tool-result-message.ts`

Displays completed tool with result:

```typescript
export class ToolResultMessage implements Component {
  // Shows: [✓] ToolName (args) (duration_ms)
  //        ⎿ result preview (truncated)
  // Or for errors:
  //        [✗] ToolName (args)
  //        ⎿ Error message
}
```

## 4. Display Format

### Running Tool
```
[●] Read (path: "/src/index.ts")
    └─ Reading...
    └─ 234 lines
```

### Completed Tool (Success)
```
[✓] Read (path: "/src/index.ts") (145ms)
    ⎿ 2453 chars
```

### Completed Tool (Error)
```
[✗] Bash (command: "rm -rf /")
    ⎿ Error: Permission denied
```

### Color Coding
- `Read` → blue
- `Write` → green
- `Edit` → yellow
- `Bash` → red
- `Glob` → cyan
- `Grep` → magenta
- `Skill` → white
- `Agent` → white

## 5. File Changes Summary

| File | Change |
|------|--------|
| `packages/shared/src/ipc/protocol.ts` | Add `StreamEvent` types |
| `apps/core/src/agent/loop.ts` | Add `onToolEvent` callback |
| `apps/core/src/agent/types.ts` | Add `RunOptions.onToolEvent` |
| `apps/core/src/server.ts` | Stream events to stdout |
| `apps/tui/src/ipc/client.ts` | Add `sessionSendStreaming` |
| `apps/tui/src/state/message-store.ts` | Add tool message methods |
| `apps/tui/src/components/tool-progress-message.ts` | NEW - in-progress display |
| `apps/tui/src/components/tool-result-message.ts` | NEW - result display |
| `apps/tui/src/components/index.ts` | Export new components |
| `apps/tui/src/index.ts` | Wire streaming into message flow |

## 6. Implementation Order

1. Add `StreamEvent` types to protocol
2. Modify CLI `session.send` to stream events
3. Add `sessionSendStreaming` to TUI IPC client
4. Add tool message state to message-store
5. Create `ToolProgressMessage` component
6. Create `ToolResultMessage` component
7. Wire into TUI index.ts
8. Test end-to-end

## 7. Edge Cases

- **No tools used**: Stream just text/done events, no tool messages
- **Multiple sequential tools**: Show each in own row, sequential updates
- **Tool with no output**: Show tool_start then tool_complete with "(no output)"
- **Very long output**: Keep only last 5 lines in state, full result in tool_complete
- **Tool error**: Show error state with error message in result