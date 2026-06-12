# FreeCode — Architecture Migration Plan

**Date:** 2026-05-24
**Status:** Draft
**Based on:** `2026-05-23-architecture.md`

---

## Overview

Migrate business logic from TUI into CLI, establishing the thin-client architecture. TUI and VSCode become pure UI shells. CLI becomes the single source of truth for all intelligence.

**Order:** `packages/shared` → `apps/core` → `apps/tui` → `apps/vscode`

Each step is independent and can be tested in isolation.

---

## Step 1: Create `packages/shared`

**Goal:** Define types and IPC protocol in one place. No duplicate type definitions.

### Files to create

```
packages/shared/
├── package.json
├── tsconfig.json
└── src/
    ├── types.ts           # Message, MessagePart, ToolResult, FileChange, etc.
    ├── ipc/
    │   └── protocol.ts    # JsonRpcRequest, JsonRpcResponse, StreamResponse, method sigs
    └── index.ts
```

### Types to define

```typescript
// types.ts
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
export interface ToolContext {
  cwd: string;
  abort?: AbortSignal;
}
export interface FileChange {
  path: string;
  action: "create" | "update" | "delete";
  content?: string;
  diff?: string;
}
export interface JsonSchema {
  type: string;
  properties?: Record<string, { description?: string; type?: string }>;
  required?: string[];
}
```

```typescript
// ipc/protocol.ts
export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number | string;
  method: string;
  params?: Record<string, unknown>;
}
export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number | string;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}
export interface StreamResponse {
  type: "text" | "code" | "tool" | "done" | "error";
  content: string;
  toolName?: string;
  toolArgs?: unknown;
  toolResult?: string;
}
```

### Methods to define

```typescript
// ipc/protocol.ts (method signatures)
export const METHODS = {
  "tools.list": {} as { params: undefined; result: ToolListItem[] },
  "tools.call": { params: { name: string; args: Record<string, unknown> }, result: ToolResult },
  "session.start": { params: { projectPath: string; provider?: string }, result: { sessionId: string } },
  "session.send": { params: { sessionId: string; message: string }, result: StreamResponse },
  "session.stop": { params: { sessionId: string }, result: void },
  "providers.list": { params: undefined; result: ProviderInfo[] },
} as const;
```

### Verification

- [ ] `npm run build` in `packages/shared` succeeds
- [ ] Can import types in both TUI and CLI

---

## Step 2: Build out `apps/core`

**Goal:** CLI becomes the full backend. Move browser, parser, context, tools, applier from TUI.

### 2.1 Create directory structure

```
apps/core/src/
├── server.ts                # (exists — may need updates)
├── agent/                   # NEW
│   ├── loop.ts              # Main agent turn loop
│   ├── session.ts           # Session state
│   └── index.ts
├── browser/                 # MOVE from TUI
│   ├── controller.ts
│   ├── providers/
│   │   ├── index.ts
│   │   ├── chatgpt.ts
│   │   └── types.ts
│   └── types.ts
├── context/                 # MOVE from TUI
│   ├── collector.ts
│   ├── strategies/
│   │   └── index.ts
│   └── types.ts
├── parser/                  # MOVE from TUI
│   ├── registry.ts
│   ├── extractors/
│   │   ├── index.ts
│   │   ├── structured.ts
│   │   ├── markdown.ts
│   │   └── json.ts
│   └── types.ts
├── tools/                   # EXISTS (read, write) — add more
│   ├── index.ts
│   ├── read.ts
│   ├── write.ts
│   ├── bash.ts              # ADD
│   ├── edit.ts              # ADD
│   ├── grep.ts              # ADD
│   ├── find.ts              # ADD
│   └── glob.ts              # ADD
└── applier/                 # MOVE from TUI commands/freecode
    ├── index.ts
    ├── differ.ts
    └── writer.ts
```

### 2.2 Copy/move code from TUI

**From `apps/tui/src/lib/browser/` → `apps/core/src/browser/`**

- `controller.ts`
- `providers/index.ts`
- `providers/chatgpt.ts`
- `providers/types.ts`
- `types.ts`

**From `apps/tui/src/lib/parser/` → `apps/core/src/parser/`**

- `registry.ts`
- `extractors/index.ts`
- `extractors/structured.ts`
- `extractors/markdown.ts`
- `extractors/json.ts`
- `types.ts`

**From `apps/tui/src/lib/context/` → `apps/core/src/context/`**

- `collector.ts`
- `strategies/index.ts`
- `types.ts`

**From `apps/tui/src/commands/freecode/` → `apps/core/src/agent/`**

- Move `executor.ts` logic to `agent/loop.ts`
- Move `file-applier.ts` logic to `applier/`

### 2.3 Add missing tools

Add `bash`, `edit`, `grep`, `find`, `glob` tools to match spec.

### 2.4 Update `server.ts`

Expand from simple tool executor to full agent server:

```typescript
const methodHandlers: Record<
  string,
  (params: Record<string, unknown>) => Promise<unknown>
> = {
  "tools.list": async () => listTools(),
  "tools.call": async (params) => {
    /* existing */
  },
  "session.start": async (params) => startSession(params),
  "session.send": async (params) => sendMessage(params), // streams responses
  "session.stop": async (params) => stopSession(params),
  "providers.list": async () => listProviders(),
};
```

### 2.5 Wire up the agent loop

`agent/loop.ts` orchestrates:

1. Collect context (file tree)
2. Send prompt to browser
3. Parse response
4. Apply file changes
5. Stream results back via IPC

### Verification

- [ ] `apps/core/src/server.ts` handles all IPC methods
- [ ] Can run `node apps/core/src/server.ts` and communicate via JSON-RPC
- [ ] Browser controller connects to Chrome via CDP
- [ ] Parser handles structured, markdown, json formats
- [ ] Tools execute correctly (read, write, bash, etc.)
- [ ] Agent loop completes a full turn: context → prompt → parse → apply

---

## Step 3: Refactor `apps/tui`

**Goal:** TUI becomes pure UI shell. Strips all business logic.

### 3.1 Remove moved code

Delete:

- `apps/tui/src/lib/browser/` (moved to CLI)
- `apps/tui/src/lib/parser/` (moved to CLI)
- `apps/tui/src/lib/context/` (moved to CLI)
- `apps/tui/src/commands/freecode/` (moved to CLI)

### 3.2 Refactor IPC client

Update `apps/tui/src/ipc/client.ts`:

- Remove duplicate protocol types — import from `@freecode/shared`
- Methods stay the same (already JSON-RPC based)

### 3.3 Refactor `index.ts` (TUI entry point)

Current: creates browser, navigates, sends prompt, parses, applies
Target: spawns CLI → sends IPC messages → renders responses

```typescript
// Target behavior
startCli(); // spawn node apps/core/src/server.ts

editor.onSubmit = async (value) => {
  const response = await sendMessage(sessionId, value);
  // stream response to TUI components
  for await (const chunk of streamResponse(response)) {
    renderChunk(chunk);
  }
};
```

### 3.4 Commands

Keep `apps/tui/src/commands/` for TUI-only commands:

- Model selection
- Theme switching
- Help, exit

Remove `/freecode` command — this logic moves to CLI `session.send`.

### Verification

- [ ] TUI connects to CLI via IPC
- [ ] Sends messages and receives streamed responses
- [ ] Renders text, code, tool result parts correctly
- [ ] No browser, parser, or file system code in TUI

---

## Step 4: Refactor `apps/vscode`

**Goal:** Same as TUI — pure UI shell.

### 4.1 Remove duplicated logic

Delete/empty:

- Any browser code
- Any parser code
- Any context collection code

### 4.2 Import types from `@freecode/shared`

Replace local `types.ts` with import from shared package.

### 4.3 Update IPC client

Same pattern as TUI — import protocol from shared, keep client implementation.

### 4.4 Wire to CLI

VSCode extension spawns CLI on startup, communicates via IPC.

### Verification

- [ ] VSCode extension connects to CLI
- [ ] Sends messages, receives streamed responses
- [ ] Renders chat messages correctly
- [ ] No business logic in extension

---

## Step 5: Test End-to-End

### Full flow test

1. Start TUI: `node apps/tui/src/index.ts`
2. Submit a prompt: `add a hello world function to src/hello.ts`
3. CLI connects to browser, navigates to ChatGPT
4. CLI collects context, sends prompt
5. ChatGPT returns response with file operations
6. CLI parses response
7. CLI shows diff preview (in TUI)
8. User approves
9. File is written to disk

### VSCode flow

1. Open VSCode, activate FreeCode extension
2. Chat panel opens
3. Submit prompt
4. Same CLI flow, result shown in chat

---

## Order of Implementation

```
Week 1:
  └─ Step 1: packages/shared (types + protocol)

Week 2-3:
  └─ Step 2: apps/core (full backend)

Week 4:
  └─ Step 3: apps/tui (refactor to thin client)
  └─ Step 4: apps/vscode (refactor to thin client)

Week 5:
  └─ Step 5: End-to-end testing
```

---

## Rollout Strategy

Since TUI currently works end-to-end, migrate piece by piece:

1. **Create shared types** (no behavior change) — safest first step
2. **Duplicate code to CLI** (both TUI and CLI have same code) — verify CLI works standalone
3. **Switch TUI to use CLI** (TUI still renders, but CLI does all logic) — cutover
4. **Remove duplicated code from TUI** — cleanup
5. **Apply same pattern to VSCode**

This way you always have a working version at each milestone.

---

## Files Summary

### Create new

```
packages/shared/全部
apps/core/src/agent/全部
apps/core/src/browser/全部 (from TUI)
apps/core/src/context/全部 (from TUI)
apps/core/src/parser/全部 (from TUI)
apps/core/src/applier/全部
apps/core/src/tools/bash.ts (new)
apps/core/src/tools/edit.ts (new)
apps/core/src/tools/grep.ts (new)
apps/core/src/tools/find.ts (new)
apps/core/src/tools/glob.ts (new)
```

### Move (copy + delete source)

```
apps/tui/src/lib/browser/ → apps/core/src/browser/
apps/tui/src/lib/parser/ → apps/core/src/parser/
apps/tui/src/lib/context/ → apps/core/src/context/
apps/tui/src/commands/freecode/executor.ts → apps/core/src/agent/loop.ts
apps/tui/src/commands/freecode/file-applier.ts → apps/core/src/applier/
```

### Delete from TUI

```
apps/tui/src/lib/browser/
apps/tui/src/lib/parser/
apps/tui/src/lib/context/
apps/tui/src/commands/freecode/
```

### Update in place

```
apps/tui/src/ipc/client.ts (use shared types)
apps/vscode/src/ipc/client.ts (use shared types)
apps/vscode/src/lib/types.ts (use shared types)
apps/tui/src/commands/freecode/index.ts (remove — logic now in CLI)
```
