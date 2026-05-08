# FreeCode TUI Design Specification

## Context

FreeCode is a CLI tool that uses the user's existing ChatGPT/Claude browser session (via Playwright/CDP automation) to help with coding tasks. It has no API costs — it drives the web UI programmatically.

The original design spec describes a TypeScript REPL CLI that drives a browser controller. This spec adds a **React + xterm.js TUI layer** on top, providing a rich, scalable interface similar to opencode but without SST ecosystem coupling.

**Why React + xterm.js:**
- Monorepo already has Next.js/web stack — patterns transfer directly
- xterm.js provides mature terminal rendering (colors, cursor, scrolling, keyboard handling)
- React gives full component model: composable, testable, extensible
- No SST/OpenTUI coupling — just React + xterm.js
- Future features (diff views, file trees, panels, plugins) slot naturally into React's component model

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                    TUI App (React)                      │
│                                                          │
│  ┌──────────────────────────────────────────────────┐   │
│  │         Terminal Layer (xterm.js)                │   │
│  │   - Renders terminal output (stdout/stderr)      │   │
│  │   - Keyboard input forwarding                    │   │
│  │   - Cursor management                            │   │
│  └──────────────────────────────────────────────────┘   │
│                                                          │
│  ┌──────────────────────────────────────────────────┐   │
│  │         UI Overlay Layer (React DOM)              │   │
│  │   - Chat message list                             │   │
│  │   - Prompt input                                  │   │
│  │   - Panels (diff view, file tree, settings)       │   │
│  │   - Dialogs, toasts, menus                        │   │
│  └──────────────────────────────────────────────────┘   │
│                                                          │
│  ┌──────────────────────────────────────────────────┐   │
│  │         Bridge Layer (IPC)                        │   │
│  │   - JSON-RPC or event-based communication         │   │
│  │   - Connects TUI to CLI backend                   │   │
│  └──────────────────────────────────────────────────┘   │
│                                                          │
└─────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────┐
│              CLI Backend (Node.js/TypeScript)            │
│  - Command parsing                                       │
│  - Browser controller (Playwright/CDP)                  │
│  - Context engine                                        │
│  - Response parser                                       │
│  - File applicator                                       │
└─────────────────────────────────────────────────────────┘
```

**Key principle:** The terminal layer and UI overlay layer are separate. The terminal renders raw output, the UI overlay renders interactive React components. They can coexist (terminal output above, UI panels overlaying).

---

## Component Hierarchy

### Core Components

```
<App>
├── <TerminalView>           // xterm.js container
│   └── xterm.js instance    // Renders stdout/stderr
├── <UIOverlay>              // React DOM layer
│   ├── <ChatLayout>
│   │   ├── <Logo>           // Visible only when idle, fades on interaction
│   │   ├── <MessageList>
│   │   │   ├── <UserMessage>
│   │   │   └── <AssistantMessage>
│   │   │       ├── <TextPart>
│   │   │       ├── <CodePart>
│   │   │       └── <ToolPart>
│   │   └── <PromptInput>
│   ├── <PanelManager>
│   │   ├── <DiffPanel>
│   │   ├── <FileTreePanel>
│   │   └── <SettingsPanel>
│   └── <LayerStack>
│       ├── <Toast>
│       ├── <Dialog>
│       └── <ContextMenu>
```

### Prompt Input Behavior (MVP)

The prompt follows a two-state UX pattern:

**Initial State (idle):**
- Logo displayed centered above the input area
- `<PromptInput>` at the bottom, always visible
- Cursor blinks in the textarea, ready for input

**Active State (user is typing):**
- Logo fades out and is removed from the DOM
- `<PromptInput>` remains at the bottom — it's a `<textarea>` that auto-resizes to fit content
  - Starts as single-line, grows up to ~5 rows
  - Beyond 5 rows, textarea scrolls internally (does not grow further)
- Messages begin appearing above the input as the conversation grows

**State transitions:**
```
[Initial] ──user starts typing──> [Logo fades out]
[Initial] ──messages exist──────> [Logo hidden, messages visible]
[Active]  ──user clears input───> [Logo stays hidden]
```

**PromptInput implementation:**
- Textarea element, not a div
- `onChange` handler tracks content height
- CSS: `field-sizing: content` for native auto-resize, with fallback JS resize
- `overflow: hidden` when under height limit, `overflow: auto` when scrolling begins
- Enter submits, Shift+Enter adds newline

This pattern mirrors opencode's approach: logo visible when idle, disappears on interaction, never returns during the session.

### Component Responsibilities

| Component | Responsibility |
|-----------|----------------|
| `<TerminalView>` | xterm.js lifecycle, keyboard/mouse event forwarding, cursor management |
| `<UIOverlay>` | Positioned absolutely over terminal, pointer events passthrough control |
| `<ChatLayout>` | Flex-column layout: messages fill space, prompt at bottom |
| `<MessageList>` | Virtualized scrolling, auto-scroll to bottom on new messages |
| `<Message>` | Renders user/assistant messages with typed parts (text, code, tool) |
| `<PromptInput>` | Textarea with history, autocomplete hooks, submit handling, logo visibility toggle |
| `<Logo>` | Centered ASCII/text logo, fades out on first user input |
| `<PanelManager>` | Manages open/closed state of side panels (diff, files, settings) |
| `<LayerStack>` | Z-index management for toasts, dialogs, context menus |

---

## State Management

### Stores (Zustand or React Context)

```typescript
// ChatStore - messages and conversation state
interface ChatStore {
  messages: Message[];
  status: 'idle' | 'streaming' | 'error';
  appendMessage: (msg: Message) => void;
  updateMessage: (id: string, patch: Partial<Message>) => void;
}

// UIPanelStore - panel visibility and state
interface UIPanelStore {
  diffPanel: { open: boolean; diff: string };
  fileTreePanel: { open: boolean; files: FileNode[] };
  settingsPanel: { open: boolean };
  togglePanel: (panel: string) => void;
}

// SessionStore - backend connection state
interface SessionStore {
  connected: boolean;
  sessionId: string | null;
  connect: () => Promise<void>;
  disconnect: () => void;
}
```

### Message Types

```typescript
type MessagePart =
  | { type: 'text'; content: string }
  | { type: 'code'; language: string; content: string }
  | { type: 'tool'; tool: ToolCall; result?: string };

interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  parts: MessagePart[];
  timestamp: number;
}

interface ToolCall {
  name: string;
  args: Record<string, unknown>;
}
```

---

## IPC Bridge Design

### Protocol

The TUI and CLI backend communicate via JSON-RPC over stdin/stdout (or a socket).

**TUI → Backend:**
```json
{ "method": "prompt", "params": { "text": "fix the bug in utils.ts" }, "id": 1 }
{ "method": "interrupt", "params": {}, "id": 2 }
{ "method": "apply_diff", "params": { "diff": "..." }, "id": 3 }
```

**Backend → TUI:**
```json
{ "event": "message", "data": { "role": "assistant", "parts": [...] } }
{ "event": "status", "data": { "status": "streaming" } }
{ "event": "tool_result", "data": { "tool": "Read", "result": "..." } }
```

### Events

| Event | Direction | Payload |
|-------|-----------|---------|
| `message` | Backend → TUI | Full message or streamed parts |
| `status` | Backend → TUI | Current status (idle, streaming, error) |
| `tool_result` | Backend → TUI | Tool execution output |
| `diff_preview` | Backend → TUI | Formatted diff for review |
| `error` | Backend → TUI | Error details |

---

## Diff View Architecture

Diff views are a first-class React component, not baked into the terminal layer.

```typescript
// DiffPanel component
interface DiffPanelProps {
  diff: string; // Unified diff format
  originalFile?: string;
  onAccept: () => void;
  onReject: () => void;
  onPartialAccept: (hunks: number[]) => void;
}
```

**Rendering approach:**
- Parse unified diff into hunks
- Render with `react-syntax-highlighter` or Shiki for syntax coloring
- Line-level click handlers for partial accept
- Side-by-side or unified view toggle

This keeps diff rendering testable and independent of terminal constraints.

---

## Key Bindings

Keybindings follow a familiar pattern (like opencode):

| Key | Action |
|-----|--------|
| `Enter` | Submit prompt |
| `Ctrl+C` | Interrupt current operation |
| `Ctrl+Z` | Undo last change |
| `Tab` | Autocomplete |
| `↑/↓` | History navigation |
| `Ctrl+P` | Toggle panel (cycles through) |
| `Ctrl+D` | Toggle diff panel |
| `Escape` | Close topmost layer/dialog |

Keybindings are registered in a central keymap module:
```typescript
const keymap = createKeymap();
keymap.bind('ctrl+c', interruptHandler);
keymap.bind('ctrl+p', cyclePanelHandler);
keymap.bind('escape', closeTopLayerHandler);
```

---

## Error Handling

| Layer | Error Handling |
|-------|----------------|
| Terminal output | Render errors in terminal view with ANSI red |
| UI overlay | Toast notifications for recoverable errors |
| IPC bridge | Auto-reconnect with exponential backoff |
| Backend | Structured error events to TUI |
| Panel state | Graceful degradation if panel data is incomplete |

---

## Testing Strategy

| Layer | Testing Approach |
|-------|-----------------|
| Components | React Testing Library — render with mock stores, assert output |
| Stores | Unit tests for state transitions |
| IPC Bridge | Integration tests with mock backend |
| E2E | Playwright for full TUI flow |

---

## Future Extensibility

The architecture supports:

- **Multiple panels** — `<PanelManager>` handles open/close state for any panel type
- **Plugin system** — Components can be registered dynamically; context providers handle DI
- **Streaming** — Message updates flow through the store; components react to partial updates
- **Theming** — CSS variables for colors, theme context for dark/light mode
- **Custom renderers** — New message part types plug into the `Message` component

---

## Implementation Approach

The TUI is a **separate app** in the monorepo (similar to how `apps/web` is separate). It can be:

1. A React app served locally (simple, fast iteration)
2. A bundled Node.js app with a WebView (Electron or neutral bundler)

For MVP, we start with a simple architecture:
- React app in `apps/tui`
- xterm.js for terminal rendering
- Zustand for state
- JSON-RPC bridge to CLI backend
- Focus on chat interface first, panels second

---

## Self-Review

- **Placeholder scan:** No TBD/TODO items — all decisions are explicit
- **Internal consistency:** Architecture supports all described components; IPC events cover all communication needs
- **Scope check:** Focused on TUI layer — backend is separate spec/implementation
- **Ambiguity check:** Component responsibilities are clear; message types are defined

Design ready for implementation planning.