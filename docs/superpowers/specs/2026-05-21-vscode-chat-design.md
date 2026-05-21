# VS Code Extension — Chat Interface

## Context

FreeCode has two apps:
- **CLI** (`apps/cli/`) — JSON-RPC server over stdin/stdout exposing `tools.list` and `tools.call`
- **TUI** (`apps/tui/`) — React terminal UI that spawns CLI as child process and communicates via JSON-RPC

The CLI backend handles browser automation (Playwright), context collection, response parsing, and file application. TUI delegates all AI interaction to CLI via IPC.

**Goal:** Create a VS Code extension (`apps/vscode/`) with a chat interface similar to the Claude VS Code extension. The extension will connect to the CLI backend via IPC (same pattern as TUI) and render messages with code blocks, tool results, etc.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     VS Code Extension                        │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │   Chat UI   │  │   Stores    │  │   IPC Client        │  │
│  │  (React)    │  │ (Zustand)   │  │ (JSON-RPC to CLI)   │  │
│  └─────────────┘  └─────────────┘  └─────────────────────┘  │
└──────────────────────────┬──────────────────────────────────┘
                           │ spawn / connect
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                     CLI Backend                             │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │ JSON-RPC    │  │  Browser    │  │   Parser / Applier  │  │
│  │  Server     │  │ Controller  │  │                     │  │
│  └─────────────┘  └─────────────┘  └─────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                  ChatGPT (Browser)                          │
└─────────────────────────────────────────────────────────────┘
```

---

## Project Structure

```
apps/
└── vscode/
    ├── package.json          # VS Code extension manifest
    ├── src/
    │   ├── extension.ts      # Entry point, activates extension
    │   ├── chat/
    │   │   ├── ChatView.tsx  # Main chat panel component
    │   │   ├── MessageList.tsx
    │   │   ├── MessageInput.tsx
    │   │   └── parts/        # Message part renderers
    │   │       ├── TextPart.tsx
    │   │       ├── CodePart.tsx
    │   │       └── ToolPart.tsx
    │   ├── stores/
    │   │   ├── chat-store.ts
    │   │   └── index.ts
    │   ├── ipc/
    │   │   ├── client.ts     # JSON-RPC client to CLI
    │   │   └── protocol.ts
    │   └── lib/
    │       └── types.ts
    └── webview/
        └── App.tsx           # Webview entry point
```

---

## IPC Protocol

The VS Code extension communicates with CLI using JSON-RPC 2.0 over stdin/stdout (same as TUI):

### Methods

| Method | Params | Returns | Description |
|--------|--------|---------|-------------|
| `tools.list` | — | `ToolListItem[]` | List available tools |
| `tools.call` | `{ name: string, args: Record<string, unknown> }` | `ToolCallResult` | Execute a tool |
| `session.start` | `{ projectPath: string }` | `{ sessionId: string }` | Start a new session |
| `session.send` | `{ sessionId: string, prompt: string }` | `StreamResponse` | Send prompt, stream response |

### Types

```typescript
interface ToolListItem {
  id: string;
  description: string;
}

interface ToolCallResult {
  title: string;
  output: string;
  metadata?: Record<string, unknown>;
}

interface StreamResponse {
  type: 'text' | 'code' | 'tool' | 'done' | 'error';
  content: string;
}
```

---

## Chat UI Components

### ChatView (Main Panel)
- Container for the entire chat interface
- Registers with VS Code's ViewContainer
- Manages webview lifecycle

### MessageList
- Renders array of `Message` objects
- Auto-scrolls to bottom on new messages
- Supports streaming updates

### MessageInput
- Multi-line text input (textarea)
- Submit on Cmd/Ctrl+Enter
- Disabled during streaming

### Message Part Renderers
- `TextPart` — Plain text with markdown rendering
- `CodePart` — Syntax highlighted code blocks with copy button
- `ToolPart` — Tool execution result with expand/collapse

---

## Data Flow

1. **User types prompt** → MessageInput
2. **User submits** (Cmd+Enter) → IPC client sends to CLI
3. **CLI parses response** → streams parts via JSON-RPC
4. **IPC client receives** → updates chat store
5. **React re-renders** → MessageList shows new content
6. **CLI applies file changes** → writes to disk
7. **Tool result** → shown as ToolPart in message

---

## Implementation Steps

1. **Scaffold VS Code extension** with `vscode.packagejson` and TypeScript config
2. **Create IPC client** (adapt from TUI's `apps/tui/src/ipc/client.ts`)
3. **Build chat UI** with React webview
4. **Implement stores** with Zustand
5. **Wire up message rendering** with part components
6. **Add streaming support** for real-time updates
7. **Test end-to-end** with CLI backend

---

## Tech Stack

- **VS Code API** — Extension activation, ViewContainer, Webview
- **React 18** — UI components
- **Zustand** — State management
- **@vscode/webview-ui-toolkit** — UI components (optional)
- **TypeScript** — Throughout

---

## Key Differences from TUI

| Aspect | TUI | VS Code |
|--------|-----|---------|
| Terminal | xterm.js + React DOM overlay | VS Code Webview API |
| Input | Single-line REPL | Multi-line textarea |
| Output | Stream to terminal | Render in chat panel |
| File changes | CLI applies directly | CLI applies, VS Code shows diff |
| Session | Ephemeral | Persisted in workspace |

---

## Not in Scope (v1)

- Inline completions / ghost text
- CMD+K quick prompt
- Multiple chat sessions
- Voice input