# Memory/Session System Design

**Date:** 2026-06-02
**Status:** Draft

---

## Overview

FreeCode's memory/session system provides persistent, resumable conversation history with remote sync capability. Sessions store complete chat history (messages, tool calls, metadata) at a central location (`~/.freecode/`), enabling interruption recovery, cross-machine resume, and URL-based session sharing.

---

## Storage Architecture

### Central Storage (`~/.freecode/`)

All session data lives centrally, not in project directories. This enables:
- Sessions persist across machines
- Project roots stay clean (no `.freecode/` cluttering git)
- Easy backup/sync of all conversation history

```
~/.freecode/
├── sessions/                    # Session data (primary)
│   └── {sessionId}/
│       ├── meta.json           # Session metadata
│       ├── messages.jsonl      # Full message transcript (streaming append)
│       └── memory.json          # Session-level memory state (compaction)
├── memory/                     # Project-level persistent memory
│   └── {projectSlug}/
│       └── memory.md           # Auto-extracted conversation notes
├── state/
│   ├── freecode.db             # SQLite (threads, turns, tool_calls)
│   └── store.json              # JSON fallback
└── config.json                # Zod-validated config
```

### Project-Level `.freecode/` (Optional)

Project roots may contain a lightweight `.freecode/` for:
- Project-specific config (`provider`, `model`, `customInstructions`)
- Session refs (pointer to central session ID, not full data)
- This is NOT where session history lives

### Session Data Structure

**`meta.json`** — Session metadata:
```typescript
interface SessionMeta {
  id: string                    // UUID
  title: string                 // Auto-generated or user-set
  projectPath: string           // Absolute path
  provider: string              // e.g., "claude", "chatgpt"
  model?: string                // e.g., "claude-opus-4-6"
  status: "active" | "interrupted" | "archived" | "deleted"
  createdAt: number             // Unix timestamp ms
  updatedAt: number
  lastTurnAt: number
  turnCount: number
  parentId?: string             // If forked from another session
  aggregatedTokenCount?: number
}
```

**`messages.jsonl`** — One JSON object per message, appended as produced:
```
{"id":"msg-1","role":"user","parts":[{"type":"text","content":"hello"}],"timestamp":1700000000000}
{"id":"msg-2","role":"assistant","parts":[{"type":"tool","tool":{"name":"Read","args":{"path":"/foo.txt"}}}],"timestamp":1700000001000}
{"id":"msg-3","role":"assistant","parts":[{"type":"tool","tool":{"name":"Read","args":{}},"result":"file contents..."}],"timestamp":1700000001500}
```

**`memory.json`** — Session compaction state (created after first compaction):
```typescript
interface SessionMemory {
  sessionId: string
  summaries: CompactionSummary[]  // Summarized message ranges
  tokenCount: number
  totalCompactions: number
  lastCompactionAt?: number
  preservedRecentMessages: SerializedMessage[]  // Last 2 turns uncompacted
}
```

---

## Session Lifecycle

### Session Start

```
session.start(projectPath, provider?, title?) → { sessionId }
```

1. Generate UUID for session
2. Create `~/.freecode/sessions/{sessionId}/`
3. Write `meta.json` with status "active"
4. Return sessionId to caller

### Turn Execution

Each turn:
1. Append user message to `messages.jsonl`
2. Run agent loop, streaming assistant messages to `messages.jsonl`
3. On tool call: append tool request
4. On tool result: append tool result
5. On turn complete: update `meta.json` (lastTurnAt, turnCount)

### Interrupt Handling (Ctrl+C)

On interrupt signal:
1. Mark current message in `messages.jsonl` with `"interrupted": true`
2. Update `meta.json` status → `"interrupted"`
3. Store interrupt point for resume detection

### Session Resume

```
session.resume(sessionId) → SessionContext
```

Resume flow:
1. Load `meta.json` for session metadata
2. Stream-read `messages.jsonl` to reconstruct full history
3. Detect interrupted state:
   - If last message has `"interrupted": true` → inject synthetic `"Continue from where you left off."` user message
4. If session has `memory.json` (compacted) → load summaries + preserved recent messages
5. Restore session state and continue

### Session Fork

```
session.fork(sessionId, point?) → { newSessionId }
```

Creates a new session branching from current point. Copies `meta.json` with new ID and `parentId` reference.

### Session Archive/Delete

- **Archive**: Mark status `"archived"`, retain all data
- **Delete**: Mark status `"deleted"`, data retained until purge

---

## Remote Sync (URL-Based Sharing)

### Export (Upload to URL)

```
session.export(sessionId) → { url: string, expiresAt: number }
```

1. Serialize session: `meta.json` + `messages.jsonl` + `memory.json`
2. Compress (gzip) and POST to sync endpoint
3. Server returns short URL code (e.g., `https://sync.freecode.dev/a3f8b2`)
4. URL valid for 7 days by default

### Import (Download from URL)

```
session.import(url) → { sessionId }
```

1. GET the URL, decompress response
2. Validate session structure
3. Create new session in `~/.freecode/sessions/` with new UUID
4. Mark as `"imported"` with original metadata preserved

### Sync Endpoint (Configurable)

Default: `https://sync.freecode.dev`
Configurable via `config.json`:
```typescript
{
  "syncEndpoint": "https://sync.freecode.dev",
  "syncApiKey"?: string,  // Optional for private sharing
  "syncUrlExpiryDays": 7
}
```

---

## Thread Store (SQLite + JSON Fallback)

For structured queries (search, list, aggregation):

**SQLite primary** (`~/.freecode/state/freecode.db`):
```sql
CREATE TABLE threads (
  id TEXT PRIMARY KEY,
  title TEXT,
  project_path TEXT,
  provider TEXT,
  status TEXT,
  created_at INTEGER,
  updated_at INTEGER,
  last_turn_at INTEGER,
  turn_count INTEGER DEFAULT 0,
  parent_id TEXT
);

CREATE TABLE turns (
  id TEXT PRIMARY KEY,
  thread_id TEXT REFERENCES threads(id),
  turn_number INTEGER,
  prompt TEXT,
  response TEXT,
  created_at INTEGER,
  duration_ms INTEGER,
  tool_call_count INTEGER DEFAULT 0
);

CREATE TABLE tool_calls (
  id TEXT PRIMARY KEY,
  turn_id TEXT REFERENCES turns(id),
  tool_name TEXT,
  args TEXT,  -- JSON
  result TEXT,
  error TEXT,
  duration_ms INTEGER,
  sequence INTEGER
);
```

**JSON fallback** (`~/.freecode/state/store.json`) — when SQLite unavailable:
```typescript
interface JsonStore {
  threads: Record<string, StoredThread>
  turns: Record<string, StoredTurn>
  metadata: { version: number; lastUpdated: number }
}
```

**Factory pattern** — always try SQLite first:
```typescript
async function getThreadStore(): Promise<ThreadStore> {
  try {
    return await SQLiteThreadStore.create()
  } catch {
    return JsonThreadStore.create()
  }
}
```

---

## Resume Picker

On startup (if interrupted session detected or user runs `/resume`):

1. Query `sessions/` for recent sessions with status `active` or `interrupted`
2. Display picker with:
   - Session title + project path
   - Last turn time (relative: "2 hours ago")
   - Status badge: "Active" / "Interrupted"
   - Turn count
3. User selects → `session.resume(selectedId)`

Keyboard navigation:
- `↑/↓` — navigate
- `Enter` — resume selected
- `Ctrl+C` — exit picker, start fresh session

---

## IPC Protocol (Session Operations)

| Method | Params | Returns | Description |
|--------|--------|---------|-------------|
| `session.start` | `{ projectPath, provider?, title? }` | `{ sessionId }` | Start new session |
| `session.resume` | `{ sessionId }` | `{ sessionId }` | Resume existing session |
| `session.list` | `{ projectPath?, status? }` | `SessionMeta[]` | List sessions |
| `session.fork` | `{ sessionId, point? }` | `{ newSessionId }` | Fork session |
| `session.archive` | `{ sessionId }` | `void` | Archive session |
| `session.delete` | `{ sessionId }` | `void` | Delete session |
| `session.export` | `{ sessionId }` | `{ url, expiresAt }` | Upload to URL |
| `session.import` | `{ url }` | `{ sessionId }` | Download from URL |
| `memory.query` | `{ query, projectPath? }` | `MemoryEntry[]` | Search memory |
| `memory.buildPrompt` | `{ projectPath }` | `string` | Build memory context |

---

## Error Handling

| Failure | Recovery |
|---------|----------|
| JSONL write fails | Fall back to buffered write, flush on turn end |
| SQLite unavailable | Fall back to JSON store |
| Import corrupt data | Reject with validation errors, never partial import |
| Export endpoint down | Save export locally, queue for retry |
| Disk full | Warn user, suggest archive/delete old sessions |

---

## v1 Scope

### Included
- [x] Session storage at `~/.freecode/sessions/`
- [x] Message streaming to JSONL (append-only)
- [x] Interrupt handling (Ctrl+C marks session interrupted)
- [x] Resume with complete chat history
- [x] Resume picker UI
- [x] Session list/fork/archive/delete
- [x] URL-based export/import

### Not in v1
- [ ] Compaction service (summarize old messages)
- [ ] Session memory (auto-extract notes to MEMORY.md)
- [ ] Teleport (remote session viewing via WebSocket)
- [ ] Background jobs tied to session lifecycle

---

## References

- claude-code: `sessionStorage.ts`, `conversationRecovery.ts`, `teleport.tsx`
- opencode: `session.ts`, `storage.ts`, `session-replay.ts`, `sync.ts`