# Memory System Implementation

> **Date:** 2026-05-31
> **Status:** Implemented
> **Inspired by:** Claude Code's memdir/ memory system

---

## Overview

FreeCode implements a **persistent, file-based memory system** inspired by Claude Code's architecture. Memories are project-scoped, allowing the agent to retain context across sessions while keeping project-specific knowledge isolated.

### Key Features

1. **Four Memory Types**: user, feedback, project, reference
2. **File-based Storage**: Markdown with frontmatter
3. **Project-scoped**: `~/.freecode/projects/<project>/memory/`
4. **MEMORY.md Index**: Quick scanning of all memories
5. **Relevance Query**: Keyword-based memory matching
6. **Prompt Injection**: Memory context in system prompts
7. **Remote Sync (USP)**: Upload/download sessions to continue on different computers

---

## Architecture

### Storage Location

```
~/.freecode/
├── projects/
│   └── <project>/
│       └── memory/
│           ├── MEMORY.md           # Index file
│           ├── user/               # User preferences, knowledge
│           │   └──<name>.md
│           ├── feedback/           # Guidance on what to avoid/repeat
│           │   └── <name>.md
│           ├── project/            # Non-derivabl context
│           │   └── <name>.md
│           └── reference/           # External system pointers
│               └── <name>.md
├── sessions/
│   └── <sessionId>/
│       ├── metadata.json          # Session info
│       └── messages.jsonl         # Full transcript
└── remote/                        # Remote session exports
    └── <sessionId>.json
```

### Memory File Format

Each memory is a Markdown file with YAML frontmatter:

```markdown
---
name: user_role
description: User is a senior Go engineer who prefers idiomatic code
type: user
---

User is a senior software engineer with 10+ years of experience. They prefer:

- Clean, idiomatic Go code
- Comprehensive error handling
- Testing with table-driven tests

**Why:** They frequently push back on over-complicated solutions and have
repeatedly asked for simpler approaches.

**How to apply:** When proposing a solution, prefer the simplest approach
that solves the problem. Avoid unnecessary abstraction layers.
```

### Memory Types

| Type | Scope | Purpose | Example |
|------|-------|---------|---------|
| `user` | private only | User's role, goals, preferences, knowledge | "User is a Go developer" |
| `feedback` | private or team | Guidance on what to avoid/repeat | "Don't use mocks in integration tests" |
| `project` | private or team | Non-derivabl context (deadlines, decisions) | "API v2 launching June 2026" |
| `reference` | usually team | External system pointers | "Bugs tracked in Linear project ENG" |

---

## Implementation

### Core Files

| File | Description |
|------|-------------|
| `memory/mem-types.ts` | `MemoryType`, `MemoryEntry`, frontmatter parsing |
| `memory/mem-store.ts` | `MemoryStore` class - file-based CRUD operations |
| `memory/mem-query.ts` | `findRelevantMemories()` - keyword-based relevance |
| `memory/mem-prompt.ts` | `buildMemoryPrompt()` - system prompt context builder |
| `session/manager.ts` | `SessionManager` - session lifecycle |
| `store/remote.ts` | `RemoteSessionSync` - cross-device sync |

### MemoryStore Class

```typescript
export class MemoryStore {
  constructor(projectPath: string)

  // Get memory directory for this project
  getMemoryDir(): string

  // Save a memory entry (creates or updates)
  save(entry: MemoryEntry): void

  // Load a specific memory by name and type
  load(name: string, type: MemoryType): MemoryEntry | undefined

  // List all memories, optionally filtered by type
  list(type?: MemoryType): MemoryEntry[]

  // Delete a memory
  delete(name: string, type: MemoryType): boolean

  // Update MEMORY.md index
  updateIndex(): void
}
```

### MemoryEntry Interface

```typescript
interface MemoryEntry {
  name: string           // Unique identifier within type
  description: string    // One-line for relevance matching
  type: MemoryType       // user | feedback | project | reference
  content: string       // Full memory content
  createdAt: number     // Unix timestamp
  updatedAt: number // Unix timestamp
}
```

### Frontmatter Parsing

```typescript
// Parse frontmatter from markdown content
parseMemoryFrontmatter(content: string): ParsedMemory

// Serialize memory entry to markdown
serializeMemoryEntry(entry: MemoryEntry): string
```

---

## IPC Methods

All methods are exposed via JSON-RPC over stdin/stdout.

### Memory Methods

| Method | Params | Returns | Description |
|--------|--------|---------|-------------|
| `memory.list` | `{ projectPath?, type? }` | `MemoryEntry[]` | List all memories |
| `memory.get` | `{ name, type, projectPath? }` | `MemoryEntry \| null` | Get specific memory |
| `memory.save` | `{ entry, projectPath? }` | `void` | Save memory entry |
| `memory.delete` | `{ name, type, projectPath? }` | `boolean` | Delete memory |
| `memory.query` | `{ query, projectPath?, limit?, types? }` | `MemoryEntry[]` | Find relevant memories |
| `memory.buildPrompt` | `{ projectPath?, includeAll?, types?, limit? }` | `string` | Build prompt context |

### Session Methods

| Method | Params | Returns | Description |
|--------|--------|---------|-------------|
| `session.list` | `{ projectPath?, status? }` | `SessionContext[]` | List sessions |
| `session.resume` | `{ sessionId }` | `SessionContext` | Resume session |
| `session.switch` | `{ sessionId }` | `void` | Switch to session |
| `session.fork` | `{ sessionId, point? }` | `string` | Fork session |
| `session.archive` | `{ sessionId }` | `void` | Archive session |
| `session.delete` | `{ sessionId }` | `void` | Delete session |

### Remote Sync Methods

| Method | Params | Returns | Description |
|--------|--------|---------|-------------|
| `session.export` | `{ sessionId }` | `ExportedSession` | Export session to JSON |
| `session.upload` | `{ sessionId, endpoint, apiKey? }` | `string` | Upload to remote URL |
| `session.download` | `{ url, endpoint?, apiKey? }` | `string` | Download and import |

---

## USP: Remote Session Sync

FreeCode's unique selling point is the ability to **continue sessions on different computers**.

### How It Works

1. **Export**: Session + messages + memories → `ExportedSession` JSON
2. **Upload**: POST to configurable endpoint (S3, GCS, or any HTTP server)
3. **Download**: GET from URL, import into local session store
4. **Resume**: Continue working with full context

### ExportedSession Format

```typescript
interface ExportedSession {
  version: 1
  metadata: {
    id: string
    title: string
    projectPath: string
    provider: string
    status: "active" | "archived" | "deleted"
    createdAt: number
    updatedAt: number
    lastTurnAt: number
    turnCount: number
    parentId?: string
  }
  messages: Array<{
    id: string
    role: "user" | "assistant"
    content: string
    timestamp: number
  }>
  memories: MemoryEntry[]
  exportedAt: number
  expiresAt?: number
}
```

### Use Cases

1. **Work from home and office**: Export at home, import at office
2. **Team collaboration**: Share session exports for code review
3. **Debugging**: Export session, send to developer for reproduction
4. **Backup**: Periodic exports to cloud storage

---

## Memory Query Algorithm

```typescript
function findRelevantMemories(
  query: string,
  store: MemoryStore,
  options: { limit?: number; types?: MemoryType[] }
): MemoryEntry[]
```

### Scoring

| Match Type | Points | Example |
|------------|--------|---------|
| Name match | 10 | query "user_role" matches memory named "user_role" |
| Description match | 5 | query "go engineer" matches description containing "Go engineer" |
| Content match | 1 | query "testing" found in memory content |

### Tokenization

- Lowercase conversion
- Remove special characters
- Split on whitespace
- Filter tokens < 3 chars

---

## Prompt Injection

Memory context is injected into system prompts via `buildMemoryPrompt()`:

```typescript
buildMemoryPrompt(store: MemoryStore, options: {
  includeAll?: boolean
  types?: MemoryType[]
  limit?: number
}): string
```

### Output Format

```
# Memory

You have a persistent, file-based memory system at `~/.freecode/projects/<project>/memory/`. This directory already exists — write to it directly (do not run mkdir).

## Types of memory
- **user**: User's role, goals, preferences, knowledge
- **feedback**: Guidance on what to avoid/repeat
- **project**: Non-derivabl context
- **reference**: External system pointers

## When to access memories
- When memories seem relevant or user references prior work
- MUST access when user asks to check/recall/remember
- If user says *ignore* memory: treat MEMORY.md as empty

---

## user

### user_role
User is a senior Go engineer...

## feedback

### no_mocks_integration
Don't use mocks in integration tests...
```

---

## Comparison with Claude Code

| Feature | Claude Code | FreeCode |
|---------|-------------|----------|
| Storage | File-based | File-based |
| Memory types | 4 (user, feedback, project, reference) | 4 (same) |
| Index | MEMORY.md | MEMORY.md |
| Query | LLM-based relevance | Keyword-based |
| Session storage | JSONL | JSONL |
| Remote sync | CCR (proprietary) | Simple file upload (USP) |

---

## Usage Examples

### Save a memory
```typescript
memoryStore.save({
  name: "go_preferences",
  description: "User prefers idiomatic Go code",
  type: "user",
  content: "User prefers clean, idiomatic Go code...",
  createdAt: Date.now(),
  updatedAt: Date.now(),
})
```

### Query relevant memories
```typescript
const memories = findRelevantMemories(
  "go testing preferences",
  memoryStore,
  { limit: 5, types: ["user", "feedback"] }
)
```

### Upload session for cross-device resume
```typescript
const remoteSync = await getRemoteSync()
const url = await remoteSync.upload(sessionId, {
  endpoint: "https://storage.example.com/sessions",
  apiKey: "your-api-key"
})
// Share `url` to download on another computer
```

### Download and resume session
```typescript
const newSessionId = await remoteSync.download(url, {
  endpoint: "https://storage.example.com/sessions"
})
const context = await sessionManager.resume(newSessionId)
```
