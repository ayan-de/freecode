# FreeCode Agent Guide

> How to work on this codebase — architectural principles, patterns, and practices.

## Project Overview

FreeCode is a CLI tool that drives ChatGPT (via Playwright/CDP) to assist with coding tasks. The architecture consists of:

- **CLI Backend** (`apps/cli/`) — Node.js/TypeScript that handles browser automation, context management, response parsing, and file application
- **TUI Frontend** (`apps/tui/`) — React + xterm.js terminal UI with layered architecture (terminal rendering + React DOM overlay)

The system uses a two-phase approach: ChatGPT first returns which files it needs, then receives those files + prompt and returns structured file changes.

---

## Architectural Principles

### Core Design Principles

1. **SOLID** — Single responsibility, Open-closed, Liskov substitution, Interface segregation, Dependency inversion
2. **YAGNI** — Only implement what's needed now; avoid speculative generalization
3. **DRY** — Don't repeat yourself; extract shared logic to single sources of truth
4. **Decomposition** — Each file/module does one thing well; avoid bloated files

### React Component Guidelines

1. **Single responsibility per component** — A component should render one UI element or compose smaller components. If a component exceeds ~150 lines, decompose it.
2. **Colocation** — Keep component-specific hooks, utils, and types near the component that uses them
3. **Composition over prop-drilling** — Use compound components, context, or composition patterns instead of passing many props through many levels
4. **Extract when used in 2+ places** — If logic/JSX is copied, extract it
5. **Pure presentational vs smart containers** — Separate data-fetching from rendering

### State Management

- **Zustand stores** (`stores/`) — Global state that crosses component boundaries (chat, panels, session)
- **Local state** (`useState`) — Component-specific state that doesn't escape the component
- **Derived state** — Compute from store values, don't duplicate in store
- **Store access in non-components** — Use `store.getState()` (not hooks) for IPC, utilities, etc.

---

## Project Structure

```
freecode/
├── apps/
│   ├── cli/                    # CLI backend (Node.js/TypeScript)
│   │   └── src/
│   │       ├── index.ts        # Entry point
│   │       ├── cli.ts          # REPL orchestration
│   │       ├── browser/        # Playwright + CDP controller
│   │       │   ├── controller.ts
│   │       │   ├── chatgpt-adapter.ts
│   │       │   └── types.ts
│   │       ├── context/        # Two-phase context engine
│   │       │   ├── engine.ts
│   │       │   └── file-tree.ts
│   │       ├── parser/         # Format-agnostic response parser
│   │       │   ├── index.ts
│   │       │   ├── json-parser.ts
│   │       │   ├── markdown-parser.ts
│   │       │   └── types.ts
│   │       ├── applier/        # File application with diff preview
│   │       │   ├── index.ts
│   │       │   ├── differ.ts
│   │       │   └── writer.ts
│   │       └── types/          # Shared types
│   └── tui/                    # React TUI frontend
│       └── src/
│           ├── app/            # Next.js app router
│           ├── components/     # UI components
│           │   ├── ChatLayout.tsx
│           │   ├── PromptInput.tsx
│           │   ├── Logo.tsx
│           │   ├── messages/   # Message rendering
│           │   │   ├── UserMessage.tsx
│           │   │   ├── AssistantMessage.tsx
│           │   │   └── parts/   # Message part renderers
│           │   │       ├── TextPart.tsx
│           │   │       ├── CodePart.tsx
│           │   │       └── ToolPart.tsx
│           │   └── ui/         # LayerStack, Toast, Dialog
│           ├── stores/          # Zustand stores
│           │   ├── chat-store.ts
│           │   ├── ui-panel-store.ts
│           │   ├── session-store.ts
│           │   └── index.ts
│           ├── ipc/             # JSON-RPC bridge to CLI
│           │   ├── bridge.ts
│           │   ├── protocol.ts
│           │   └── client.ts
│           └── hooks/           # Custom hooks
│               └── useAutoResize.ts
├── packages/
│   └── shared/                 # Shared types between apps
│       └── src/
│           └── types.ts
└── docs/
    └── superpowers/
        ├── specs/              # Design specifications
        └── plans/             # Implementation plans
```

---

## Component Design Patterns

### Message Parts Pattern

Messages contain typed `parts`:

```typescript
type MessagePart =
  | { type: 'text'; content: string }
  | { type: 'code'; language: string; content: string }
  | { type: 'tool'; tool: { name: string; args: Record<string, unknown> }; result?: string }
```

Each part type has its own component (`TextPart`, `CodePart`, `ToolPart`). The parent `Message` component switches on type:

```typescript
// In AssistantMessage.tsx
{message.parts.map((part, i) => {
  switch (part.type) {
    case 'text': return <TextPart key={i} content={part.content} />
    case 'code': return <CodePart key={i} language={part.language} content={part.content} />
    case 'tool': return <ToolPart key={i} tool={part.tool} result={part.result} />
  }
})}
```

### Store Pattern

Each store is in its own file with co-located types:

```typescript
// stores/chat-store.ts
interface ChatStore {
  messages: Message[]
  status: 'idle' | 'streaming' | 'error'
  // ...
}
export const useChatStore = create<ChatStore>((set) => ({ /* ... */ }))
```

Export from `stores/index.ts` for clean imports:

```typescript
export { useChatStore, type Message, type MessagePart } from './chat-store'
```

### Hook Pattern

Custom hooks encapsulate logic and state:

```typescript
// hooks/useAutoResize.ts
export function useAutoResize(options: UseAutoResizeOptions = {}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const resize = useCallback(() => { /* ... */ }, [])
  return { textareaRef, resize }
}
```

---

## File Naming Conventions

| Type | Convention | Example |
|------|-----------|---------|
| Components | PascalCase | `ChatLayout.tsx`, `CodePart.tsx` |
| Stores | kebab-case | `chat-store.ts`, `ui-panel-store.ts` |
| Hooks | camelCase with `use` prefix | `useAutoResize.ts` |
| Utilities | camelCase | `file-tree.ts`, `differ.ts` |
| Types/Interfaces | PascalCase | `types.ts` exports `FileChange`, `ParsedResponse` |

---

## Adding New Features

### 1. Identify the domain

- **Browser layer** (`apps/cli/src/browser/`) — Playwright/CDP, DOM adapters
- **Context layer** (`apps/cli/src/context/`) — File tree, context compilation
- **Parser layer** (`apps/cli/src/parser/`) — Response parsing (JSON/markdown/tool)
- **Applier layer** (`apps/cli/src/applier/`) — File writing, diff generation
- **UI components** (`apps/tui/src/components/`) — React components

### 2. Check existing patterns

Before adding code, verify:
- Does a similar pattern exist? Follow it.
- Is this functionality needed in more than one place? Extract to shared.
- Does this component do more than one thing? Decompose.

### 3. File limits

If a file exceeds ~150 lines, decompose:
- Extract sub-components
- Move helper functions to `lib/` or `utils/`
- Split store logic into separate files

### 4. Testing

- **Components** — React Testing Library
- **Stores** — Unit tests for state transitions
- **IPC** — Integration tests with mock backend
- **E2E** — Playwright for full flow

---

## Key invariants

1. **Components are dumb** — They receive props and render UI; business logic lives in stores/hooks
2. **Stores are flat** — No nested store composition; use selectors for derived state
3. **IPC is centralized** — All TUI→backend communication goes through `ipc/client.ts`
4. **Types are shared** — Core domain types (`FileChange`, `ParsedResponse`) live in `packages/shared`
5. **DOM adapters are isolated** — ChatGPT/Claude adapters in `browser/` can be swapped without changing core logic

---

## Deferred Items (Not Yet Implemented)

- Rust TUI for richer terminal UI
- Provider adapters (Claude, Gemini)
- Context intelligence (graphify/contextcarry integration)
- VS Code extension
- Autonomous multi-step agents
- Vector DB / semantic search

Don't implement these unless explicitly requested.