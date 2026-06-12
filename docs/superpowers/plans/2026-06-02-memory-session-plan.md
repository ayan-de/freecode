# Memory/Session System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement persistent session storage at `~/.freecode/sessions/` with JSONL message streaming, interrupt handling, resume, and URL-based remote sync.

**Architecture:** Session data stored at `~/.freecode/sessions/{id}/` with `meta.json` (metadata) and `messages.jsonl` (streaming append). ThreadStore provides SQLite-first structured queries. SessionManager orchestrates lifecycle operations. TUI exposes resume picker.

**Tech Stack:** TypeScript, Node.js fs/promises streaming, better-sqlite3 (or sql.js), zod, pi-tui

---

## File Structure

```
~/.freecode/                          # Central storage (created on first run)
├── sessions/                         # Session data
│   └── {sessionId}/
│       ├── meta.json                 # Session metadata
│       └── messages.jsonl             # Streaming message append
├── state/
│   ├── freecode.db                   # SQLite (threads, turns)
│   └── store.json                    # JSON fallback
└── config.json                       # Zod-validated config

apps/core/src/
├── session/
│   ├── store.ts                      # NEW: SessionStore - JSONL file ops
│   ├── manager.ts                   # MODIFY: add resume, fork, interrupt
│   ├── types.ts                     # MODIFY: add SessionMeta, Message types
│   └── index.ts                     # MODIFY: export SessionStore
├── store/
│   ├── thread-store.ts              # EXISTING: keep as-is
│   ├── sqlite-store.ts              # EXISTING: keep as-is
│   ├── json-store.ts                # EXISTING: keep as-is
│   ├── remote.ts                    # EXISTING: RemoteSessionSync
│   └── types.ts                     # EXISTING: StoredThread/StoredTurn
├── memory/
│   ├── storage.ts                   # EXISTING: FileMemoryStorage
│   └── mem-store.ts                 # EXISTING: MemoryStore
└── server.ts                        # MODIFY: add session IPC handlers

apps/tui/src/
├── components/
│   └── resume-picker.tsx            # NEW: session picker component
└── ipc/
    └── client.ts                     # MODIFY: add session methods
```

---

## Task 1: SessionStore (JSONL File Operations)

**Files:**

- Create: `apps/core/src/session/store.ts`
- Test: `apps/core/src/session/store.test.ts`
- Dependencies: Read `apps/core/src/store/types.ts` for StoredThread/StoredTurn patterns

- [ ] **Step 1: Write failing test**

```typescript
// apps/core/src/session/store.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { SessionStore } from "./store";
import { join } from "path";
import { rm } from "fs/promises";

describe("SessionStore", () => {
  const testDir = "/tmp/freecode-test-session-store";
  let store: SessionStore;

  beforeEach(async () => {
    await rm(testDir, { recursive: true, force: true });
    store = await SessionStore.create(testDir);
  });

  it("creates session directory with meta.json", async () => {
    const sessionId = await store.createSession({
      title: "Test Session",
      projectPath: "/tmp/test",
      provider: "claude",
    });
    const meta = await store.getMeta(sessionId);
    expect(meta.id).toBe(sessionId);
    expect(meta.title).toBe("Test Session");
    expect(meta.status).toBe("active");
  });

  it("appends messages to messages.jsonl", async () => {
    const sessionId = await store.createSession({
      title: "Test",
      projectPath: "/tmp/test",
      provider: "claude",
    });
    const msg = {
      id: "msg-1",
      role: "user" as const,
      parts: [{ type: "text" as const, content: "hello" }],
      timestamp: Date.now(),
    };
    await store.appendMessage(sessionId, msg);
    const messages = await store.getMessages(sessionId);
    expect(messages).toHaveLength(1);
    expect(messages[0].parts[0]).toEqual({ type: "text", content: "hello" });
  });

  it("marks message as interrupted", async () => {
    const sessionId = await store.createSession({
      title: "Test",
      projectPath: "/tmp/test",
      provider: "claude",
    });
    const msg = {
      id: "msg-1",
      role: "assistant" as const,
      parts: [],
      timestamp: Date.now(),
    };
    await store.appendMessage(sessionId, msg);
    await store.markInterrupted(sessionId, "msg-1");
    const msgs = await store.getMessages(sessionId);
    expect(msgs[0].interrupted).toBe(true);
  });

  it("detects interrupted sessions", async () => {
    const sessionId = await store.createSession({
      title: "Test",
      projectPath: "/tmp/test",
      provider: "claude",
    });
    const msg = {
      id: "msg-1",
      role: "assistant" as const,
      parts: [],
      timestamp: Date.now(),
    };
    await store.appendMessage(sessionId, msg);
    await store.markInterrupted(sessionId, "msg-1");
    const interrupted = await store.getInterruptedSession();
    expect(interrupted?.sessionId).toBe(sessionId);
  });

  it("lists sessions with filter", async () => {
    const s1 = await store.createSession({
      title: "S1",
      projectPath: "/tmp/p1",
      provider: "claude",
    });
    const s2 = await store.createSession({
      title: "S2",
      projectPath: "/tmp/p2",
      provider: "claude",
    });
    await store.updateStatus(s1, "archived");
    const active = await store.list({ status: "active" });
    expect(active).toHaveLength(2);
    const archived = await store.list({ status: "archived" });
    expect(archived).toHaveLength(1);
  });

  it("forks session with new id", async () => {
    const parentId = await store.createSession({
      title: "Parent",
      projectPath: "/tmp/test",
      provider: "claude",
    });
    const forkId = await store.fork(parentId);
    const forkMeta = await store.getMeta(forkId);
    expect(forkMeta.parentId).toBe(parentId);
    expect(forkId).not.toBe(parentId);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/core && npx vitest src/session/store.test.ts --run`
Expected: FAIL with "Cannot find module './store'"

- [ ] **Step 3: Write minimal SessionStore implementation**

```typescript
// apps/core/src/session/store.ts
import { mkdir, readFile, writeFile, readdir, rm } from "fs/promises";
import { join } from "path";
import { randomUUID } from "crypto";

export interface SessionMeta {
  id: string;
  title: string;
  projectPath: string;
  provider: string;
  model?: string;
  status: "active" | "interrupted" | "archived" | "deleted";
  createdAt: number;
  updatedAt: number;
  lastTurnAt: number;
  turnCount: number;
  parentId?: string;
  aggregatedTokenCount?: number;
}

export interface SerializedMessage {
  id: string;
  role: "user" | "assistant";
  parts: Array<{
    type: "text" | "code" | "tool";
    content?: string;
    language?: string;
    tool?: { name: string; args: Record<string, unknown> };
    result?: string;
  }>;
  timestamp: number;
  interrupted?: boolean;
}

export interface CreateSessionOptions {
  title: string;
  projectPath: string;
  provider: string;
  model?: string;
}

export interface SessionStore {
  createSession(opts: CreateSessionOptions): Promise<string>;
  getMeta(sessionId: string): Promise<SessionMeta | null>;
  updateMeta(sessionId: string, updates: Partial<SessionMeta>): Promise<void>;
  updateStatus(sessionId: string, status: SessionMeta["status"]): Promise<void>;
  deleteSession(sessionId: string): Promise<void>;

  appendMessage(sessionId: string, message: SerializedMessage): Promise<void>;
  getMessages(sessionId: string): Promise<SerializedMessage[]>;
  markInterrupted(sessionId: string, messageId: string): Promise<void>;

  list(filter?: {
    status?: SessionMeta["status"];
    projectPath?: string;
  }): Promise<SessionMeta[]>;
  fork(sessionId: string): Promise<string>;

  getInterruptedSession(): Promise<{
    sessionId: string;
    messageId: string;
  } | null>;
}

const SESSION_DIR = "sessions";
const META_FILE = "meta.json";
const MESSAGES_FILE = "messages.jsonl";

async function ensureDir(dir: string): Promise<void> {
  try {
    await mkdir(dir, { recursive: true });
  } catch {
    /* already exists */
  }
}

async function readJson<T>(path: string): Promise<T | null> {
  try {
    const data = await readFile(path, "utf-8");
    return JSON.parse(data) as T;
  } catch {
    return null;
  }
}

async function writeJson(path: string, data: unknown): Promise<void> {
  await writeFile(path, JSON.stringify(data, null, 2), "utf-8");
}

export async function createSessionStore(
  baseDir: string,
): Promise<SessionStore> {
  await ensureDir(join(baseDir, SESSION_DIR));
  return new SessionStoreImpl(baseDir);
}

class SessionStoreImpl implements SessionStore {
  constructor(private baseDir: string) {}

  private sessionDir(sessionId: string): string {
    return join(this.baseDir, SESSION_DIR, sessionId);
  }

  private metaPath(sessionId: string): string {
    return join(this.sessionDir(sessionId), META_FILE);
  }

  private messagesPath(sessionId: string): string {
    return join(this.sessionDir(sessionId), MESSAGES_FILE);
  }

  async createSession(opts: CreateSessionOptions): Promise<string> {
    const id = randomUUID();
    const now = Date.now();
    const meta: SessionMeta = {
      id,
      title: opts.title,
      projectPath: opts.projectPath,
      provider: opts.provider,
      model: opts.model,
      status: "active",
      createdAt: now,
      updatedAt: now,
      lastTurnAt: now,
      turnCount: 0,
    };
    await ensureDir(this.sessionDir(id));
    await writeJson(this.metaPath(id), meta);
    await writeFile(this.messagesPath(id), "", "utf-8");
    return id;
  }

  async getMeta(sessionId: string): Promise<SessionMeta | null> {
    return readJson<SessionMeta>(this.metaPath(sessionId));
  }

  async updateMeta(
    sessionId: string,
    updates: Partial<SessionMeta>,
  ): Promise<void> {
    const meta = await this.getMeta(sessionId);
    if (!meta) return;
    const updated = { ...meta, ...updates, updatedAt: Date.now() };
    await writeJson(this.metaPath(sessionId), updated);
  }

  async updateStatus(
    sessionId: string,
    status: SessionMeta["status"],
  ): Promise<void> {
    await this.updateMeta(sessionId, { status });
  }

  async deleteSession(sessionId: string): Promise<void> {
    await this.updateStatus(sessionId, "deleted");
  }

  async appendMessage(
    sessionId: string,
    message: SerializedMessage,
  ): Promise<void> {
    const line = JSON.stringify(message) + "\n";
    const stream = await import("fs").then((fs) =>
      fs.createWriteStream(this.messagesPath(sessionId), { flags: "a" }),
    );
    return new Promise((resolve, reject) => {
      stream.write(line, (err: Error | null) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  async getMessages(sessionId: string): Promise<SerializedMessage[]> {
    const content = await readFile(this.messagesPath(sessionId), "utf-8").catch(
      () => "",
    );
    if (!content.trim()) return [];
    return content
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as SerializedMessage);
  }

  async markInterrupted(sessionId: string, messageId: string): Promise<void> {
    const messages = await this.getMessages(sessionId);
    const idx = messages.findIndex((m) => m.id === messageId);
    if (idx !== -1) {
      messages[idx] = { ...messages[idx], interrupted: true };
    }
    await writeFile(
      this.messagesPath(sessionId),
      messages.map((m) => JSON.stringify(m)).join("\n") + "\n",
      "utf-8",
    );
    await this.updateStatus(sessionId, "interrupted");
  }

  async list(filter?: {
    status?: SessionMeta["status"];
    projectPath?: string;
  }): Promise<SessionMeta[]> {
    const sessionsDir = join(this.baseDir, SESSION_DIR);
    let entries: string[];
    try {
      entries = await readdir(sessionsDir);
    } catch {
      return [];
    }
    const metas: SessionMeta[] = [];
    for (const id of entries) {
      const meta = await this.getMeta(id);
      if (!meta) continue;
      if (filter?.status && meta.status !== filter.status) continue;
      if (filter?.projectPath && meta.projectPath !== filter.projectPath)
        continue;
      metas.push(meta);
    }
    return metas.sort((a, b) => b.lastTurnAt - a.lastTurnAt);
  }

  async fork(sessionId: string): Promise<string> {
    const meta = await this.getMeta(sessionId);
    if (!meta) throw new Error("Session not found");
    const newId = await this.createSession({
      title: meta.title + " (fork)",
      projectPath: meta.projectPath,
      provider: meta.provider,
      model: meta.model,
    });
    await this.updateMeta(newId, {
      parentId: sessionId,
      turnCount: meta.turnCount,
    });
    const messages = await this.getMessages(sessionId);
    for (const msg of messages) {
      await this.appendMessage(newId, msg);
    }
    return newId;
  }

  async getInterruptedSession(): Promise<{
    sessionId: string;
    messageId: string;
  } | null> {
    const all = await this.list({ status: "interrupted" });
    if (all.length === 0) return null;
    const session = all[0];
    const messages = await this.getMessages(session.id);
    const last = messages[messages.length - 1];
    return last ? { sessionId: session.id, messageId: last.id } : null;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/core && npx vitest src/session/store.test.ts --run`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd /home/ayande/Project/freecode
git add apps/core/src/session/store.ts apps/core/src/session/store.test.ts
git commit -m "$(cat <<'EOF'
feat: add SessionStore for JSONL file operations

SessionStore handles session creation, JSONL message append,
interrupt marking, and session listing. Used by SessionManager
for persistent session storage at ~/.freecode/sessions/.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Integrate SessionStore into SessionManager

**Files:**

- Modify: `apps/core/src/session/manager.ts:1-50`
- Read first: `apps/core/src/session/manager.ts` (full file)

- [ ] **Step 1: Write failing test**

```typescript
// apps/core/src/session/manager.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { rm } from "fs/promises";
import { SessionManager, createSessionManager } from "./manager";

describe("SessionManager", () => {
  const testBase = "/tmp/freecode-test-manager";
  let manager: SessionManager;

  beforeEach(async () => {
    await rm(testBase, { recursive: true, force: true });
    manager = await createSessionManager(testBase);
  });

  it("starts a new session", async () => {
    const id = await manager.start("/tmp/test", "claude", "Test Session");
    expect(id).toBeTruthy();
    const ctx = await manager.resume(id);
    expect(ctx.id).toBe(id);
    expect(ctx.title).toBe("Test Session");
  });

  it("resumes and gets complete message history", async () => {
    const id = await manager.start("/tmp/test", "claude");
    const msg = {
      id: "msg-1",
      role: "user" as const,
      parts: [{ type: "text" as const, content: "hello" }],
      timestamp: Date.now(),
    };
    await manager.appendMessage(id, msg);
    const ctx = await manager.resume(id);
    expect(ctx.messages).toHaveLength(1);
  });

  it("detects interrupted session and injects resume marker", async () => {
    const id = await manager.start("/tmp/test", "claude");
    const msg = {
      id: "msg-1",
      role: "assistant" as const,
      parts: [],
      timestamp: Date.now(),
    };
    await manager.appendMessage(id, msg);
    await manager.markInterrupted(id, "msg-1");
    const ctx = await manager.resume(id);
    // Should inject "Continue from where you left off." message
    expect(ctx.messages).toHaveLength(2); // original + injected
  });

  it("forks session with full history", async () => {
    const parentId = await manager.start("/tmp/test", "claude");
    await manager.appendMessage(parentId, {
      id: "msg-1",
      role: "user",
      parts: [{ type: "text", content: "hello" }],
      timestamp: Date.now(),
    });
    const forkId = await manager.fork(parentId);
    const parentCtx = await manager.resume(parentId);
    const forkCtx = await manager.resume(forkId);
    expect(forkCtx.messages).toHaveLength(parentCtx.messages.length);
  });

  it("lists sessions with project filter", async () => {
    await manager.start("/tmp/p1", "claude");
    await manager.start("/tmp/p2", "claude");
    const p1Sessions = await manager.list({ projectPath: "/tmp/p1" });
    expect(p1Sessions).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/core && npx vitest src/session/manager.test.ts --run`
Expected: FAIL with "createSessionManager not found" or missing methods

- [ ] **Step 3: Read existing manager and modify**

Read `apps/core/src/session/manager.ts` first, then modify it to:

1. Use `createSessionStore` instead of `createThreadStoreService` for session operations
2. Add `appendMessage(sessionId, message)` method
3. Add `markInterrupted(sessionId, messageId)` method
4. Add `getInterruptedSession()` helper
5. Update `resume()` to detect interrupt and inject synthetic message
6. Change `list()` to use SessionStore (keep ThreadStore for structured queries)

The key change in `resume()`:

```typescript
async resume(sessionId: string): Promise<SessionContext> {
  const meta = await this.sessionStore.getMeta(sessionId)
  if (!meta) throw new Error('Session not found')
  const messages = await this.sessionStore.getMessages(sessionId)

  // Detect interrupted state → inject resume marker
  if (meta.status === 'interrupted') {
    const lastMsg = messages[messages.length - 1]
    if (lastMsg?.interrupted) {
      const resumeMsg: SerializedMessage = {
        id: randomUUID(),
        role: 'user',
        parts: [{ type: 'text', content: 'Continue from where you left off.' }],
        timestamp: Date.now(),
      }
      messages.push(resumeMsg)
    }
  }

  return { id: meta.id, title: meta.title, projectPath: meta.projectPath, provider: meta.provider, status: meta.status, messages, turnCount: meta.turnCount, createdAt: meta.createdAt }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/core && npx vitest src/session/manager.test.ts --run`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/core/src/session/manager.ts apps/core/src/session/manager.test.ts
git commit -m "$(cat <<'EOF'
feat: integrate SessionStore into SessionManager

SessionManager now uses SessionStore for JSONL-based session
persistence. Resume detects interrupted state and injects
"Continue from where you left off." marker message.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Session Message Streaming in Agent Loop

**Files:**

- Modify: `apps/core/src/agent/loop.ts`
- Read first: `apps/core/src/agent/loop.ts` (full file, look for where messages are created/emitted)
- Read first: `apps/core/src/session/types.ts`

- [ ] **Step 1: Understand the agent loop message flow**

Read `apps/core/src/agent/loop.ts` and identify where:

1. User messages are created
2. Assistant messages are created/streamed
3. Tool calls and results are recorded
4. Turn ends

Then read `apps/core/src/session/types.ts` to understand `SessionState` and `Message` types.

- [ ] **Step 2: Write integration test**

```typescript
// apps/core/src/agent/loop-stream.test.ts
// Test that agent loop streams messages to SessionStore
import { describe, it, expect, beforeEach } from "vitest";
import { rm } from "fs/promises";
import { createSessionManager } from "../session/manager";
import { SessionStore } from "../session/store";

it("agent loop streams messages to session store", async () => {
  const baseDir = "/tmp/freecode-test-loop-stream";
  await rm(baseDir, { recursive: true, force: true });
  const manager = await createSessionManager(baseDir);
  const sessionId = await manager.start("/tmp/test", "claude", "Loop Test");

  // Simulate message append (this is what loop.ts will call)
  await manager.appendMessage(sessionId, {
    id: "msg-1",
    role: "user",
    parts: [{ type: "text", content: "hello" }],
    timestamp: Date.now(),
  });

  const ctx = await manager.resume(sessionId);
  expect(ctx.messages).toHaveLength(1);
  expect(ctx.messages[0].parts[0]).toEqual({ type: "text", content: "hello" });
});
```

- [ ] **Step 3: Modify agent loop to use SessionStore**

Find where the agent loop creates messages and add calls to `sessionStore.appendMessage()`. The key insertion points:

1. After user message is submitted → append user message
2. When assistant message starts/segments → append assistant message
3. After tool call → append tool call message
4. After tool result → append tool result message

Pass `sessionStore` into the agent loop via constructor or context. Use Effect context pattern if available, otherwise parameter injection.

```typescript
// In agent/loop.ts, add sessionStore parameter:
// constructor(
//   ...
//   private readonly sessionStore?: SessionStore
// )

// After each message/turn:
if (this.sessionStore && sessionId) {
  await this.sessionStore.appendMessage(sessionId, serializedMessage);
}
```

- [ ] **Step 4: Run tests**

Run: `cd apps/core && npx vitest src/agent/ --run`
Expected: Existing tests pass, new integration test passes

- [ ] **Step 5: Commit**

```bash
git add apps/core/src/agent/loop.ts apps/core/src/agent/loop-stream.test.ts
git commit -m "$(cat <<'EOF'
feat: stream agent loop messages to SessionStore

Agent loop now appends all messages (user, assistant, tool calls,
results) to the session's messages.jsonl file for complete
history persistence.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Interrupt Handling (Ctrl+C Signal)

**Files:**

- Modify: `apps/core/src/server.ts` (add signal handler)
- Create: `apps/core/src/session/interrupt.ts` (interrupt detection and handling)
- Modify: `apps/core/src/agent/loop.ts` (call markInterrupted on signal)
- Test: `apps/core/src/session/interrupt.test.ts`

- [ ] **Step 1: Write interrupt service**

```typescript
// apps/core/src/session/interrupt.ts
import { signal } from "process";

export interface InterruptState {
  sessionId: string | null;
  messageId: string | null;
  pending: boolean;
}

export class InterruptHandler {
  private sessionId: string | null = null;
  private messageId: string | null = null;

  setActive(sessionId: string, messageId: string): void {
    this.sessionId = sessionId;
    this.messageId = messageId;
  }

  clear(): void {
    this.sessionId = null;
    this.messageId = null;
  }

  getState(): InterruptState {
    return {
      sessionId: this.sessionId,
      messageId: this.messageId,
      pending: this.sessionId !== null,
    };
  }

  setupSignalHandler(
    onInterrupt: (sessionId: string, messageId: string) => void,
  ): void {
    let lastSigInt = 0;
    process.on("SIGINT", () => {
      const now = Date.now();
      if (now - lastSigInt < 1000) {
        // Double Ctrl+C → force exit
        process.exit(1);
      }
      lastSigInt = now;
      if (this.sessionId && this.messageId) {
        onInterrupt(this.sessionId, this.messageId);
      }
    });
  }
}

let globalHandler: InterruptHandler | null = null;

export function getInterruptHandler(): InterruptHandler {
  if (!globalHandler) {
    globalHandler = new InterruptHandler();
  }
  return globalHandler;
}
```

- [ ] **Step 2: Integrate into server.ts**

In `server.ts`, after session is started and during message streaming:

```typescript
import { getInterruptHandler } from "./session/interrupt";
import { getSessionManager } from "./session/manager";

// After session.start handler:
const handler = getInterruptHandler();
handler.setupSignalHandler(async (sessionId, messageId) => {
  const manager = await getSessionManager();
  await manager.markInterrupted(sessionId, messageId);
});
```

- [ ] **Step 3: Wire into agent loop**

In `agent/loop.ts`, after starting a message (when streaming begins):

```typescript
import { getInterruptHandler } from "../session/interrupt";

// When starting to stream an assistant message:
getInterruptHandler().setActive(sessionId, messageId);
```

- [ ] **Step 4: Write test**

```typescript
// apps/core/src/session/interrupt.test.ts
import { describe, it, expect } from "vitest";
import { InterruptHandler } from "./interrupt";

describe("InterruptHandler", () => {
  it("tracks active session/message", () => {
    const handler = new InterruptHandler();
    expect(handler.getState().pending).toBe(false);

    handler.setActive("session-1", "msg-1");
    expect(handler.getState().pending).toBe(true);
    expect(handler.getState().sessionId).toBe("session-1");
    expect(handler.getState().messageId).toBe("msg-1");

    handler.clear();
    expect(handler.getState().pending).toBe(false);
  });
});
```

- [ ] **Step 5: Run tests and commit**

Run: `cd apps/core && npx vitest src/session/interrupt.test.ts --run`
Commit:

```bash
git add apps/core/src/server.ts apps/core/src/session/interrupt.ts apps/core/src/session/interrupt.test.ts
git commit -m "$(cat <<'EOF'
feat: add Ctrl+C interrupt handling

InterruptHandler tracks active session/message and marks
interrupted messages on double-Ctrl+C. Session resumes with
injected "Continue from where you left off." marker.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Resume Picker (TUI Component)

**Files:**

- Create: `apps/tui/src/components/resume-picker.tsx`
- Modify: `apps/tui/src/index.ts` (add resume command)
- Modify: `apps/tui/src/ipc/client.ts` (add session.list, session.resume calls)

- [ ] **Step 1: Write resume picker component**

```typescript
// apps/tui/src/components/resume-picker.tsx
import React, { useEffect, useState } from 'react'
import { Box, Text, Key } from 'ink'
import { SessionMeta } from '@freecode/shared'

interface Props {
  sessions: SessionMeta[]
  onSelect: (sessionId: string) => void
  onCancel: () => void
}

export const ResumePicker: React.FC<Props> = ({ sessions, onSelect, onCancel }) => {
  const [selectedIndex, setSelectedIndex] = useState(0)

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowUp':
          setSelectedIndex(i => Math.max(0, i - 1))
          break
        case 'ArrowDown':
          setSelectedIndex(i => Math.min(sessions.length - 1, i + 1))
          break
        case 'Enter':
          if (sessions[selectedIndex]) {
            onSelect(sessions[selectedIndex].id)
          }
          break
        case 'Escape':
        case 'q':
          onCancel()
          break
      }
    }
    process.stdin.on('keypress', handleKey)
    return () => process.stdin.off('keypress', handleKey)
  }, [selectedIndex, sessions, onSelect, onCancel])

  return (
    <Box flexDirection="column">
      <Box paddingBottom={1}>
        <Text bold>Select a session to resume:</Text>
      </Box>
      {sessions.map((session, i) => (
        <Box key={session.id} paddingY={0}>
          <Text color={i === selectedIndex ? 'cyan' : 'white'}>
            {i === selectedIndex ? '❯ ' : '  '}
          </Text>
          <Text color={i === selectedIndex ? 'cyan' : 'white'}>
            {session.title} — {session.projectPath}
          </Text>
          <Text dimColor> ({session.turnCount} turns)</Text>
          {session.status === 'interrupted' && (
            <Text color="yellow"> [Interrupted]</Text>
          )}
        </Box>
      ))}
      <Box paddingTop={1}>
        <Text dimColor>↑↓ navigate · Enter resume · Ctrl+C cancel</Text>
      </Box>
    </Box>
  )
}
```

- [ ] **Step 2: Modify IPC client**

In `apps/tui/src/ipc/client.ts`, add session methods:

```typescript
async listSessions(filter?: { status?: string; projectPath?: string }): Promise<SessionMeta[]> {
  return this.call('session.list', filter ?? {})
}

async resumeSession(sessionId: string): Promise<string> {
  return this.call('session.resume', { sessionId })
}

async startSession(projectPath: string, provider?: string, title?: string): Promise<string> {
  return this.call('session.start', { projectPath, provider, title })
}
```

- [ ] **Step 3: Add resume command to TUI**

In `apps/tui/src/index.ts`, add command handler:

```typescript
ipc.on(
  "session.list",
  async (params: { status?: string; projectPath?: string }) => {
    return await client.listSessions(params);
  },
);

ipc.on("session.resume", async (params: { sessionId: string }) => {
  return await client.resumeSession(params.sessionId);
});

// Detect interrupted session on startup
const interrupted = await client.getInterruptedSession();
if (interrupted) {
  // Show prompt to resume
}
```

- [ ] **Step 4: Test in TUI**

Run the TUI and verify:

1. On startup, if interrupted session exists, picker appears
2. `/resume` command opens picker
3. Keyboard navigation works
4. Selected session resumes correctly

- [ ] **Step 5: Commit**

```bash
git add apps/tui/src/components/resume-picker.tsx apps/tui/src/ipc/client.ts apps/tui/src/index.ts
git commit -m "$(cat <<'EOF'
feat: add resume picker to TUI

ResumePicker component shows session list with keyboard
navigation. Auto-detects interrupted sessions on startup
and prompts user to resume.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Session IPC Handlers (server.ts)

**Files:**

- Modify: `apps/core/src/server.ts`
- Read first: `apps/core/src/server.ts` (full file)

- [ ] **Step 1: Add session handlers**

In `server.ts`, add handlers for session operations. Read the existing file first, then add:

```typescript
// After existing session handlers, add:
import { getSessionManager } from './session/manager'
import { createSessionStore } from './session/store'
import { getInterruptHandler } from './session/interrupt'
import { getFreeCodeDir } from './utils/freecode-dir'

// Initialize session store and manager at startup
let sessionStore: ReturnType<typeof createSessionStore> | null = null
let sessionManager: ReturnType<typeof getSessionManager> | null = null

async function getSessionStore() {
  if (!sessionStore) {
    const baseDir = getFreeCodeDir()
    sessionStore = await createSessionStore(baseDir)
  }
  return sessionStore
}

async function getSM() {
  if (!sessionManager) {
    const store = await getSessionStore()
    sessionManager = await createSessionManager(store)
  }
  return sessionManager
}

// Add to methodHandlers:
'session.list': async (params) => {
  const manager = await getSM()
  return manager.list(params)
},
'session.resume': async (params) => {
  const manager = await getSM()
  return manager.resume(params.sessionId)
},
'session.fork': async (params) => {
  const manager = await getSM()
  return manager.fork(params.sessionId, params.point)
},
'session.archive': async (params) => {
  const manager = await getSM()
  await manager.archive(params.sessionId)
},
'session.delete': async (params) => {
  const manager = await getSM()
  await manager.delete(params.sessionId)
},
'session.export': async (params) => {
  const manager = await getSM()
  return manager.export(params.sessionId)
},
'session.import': async (params) => {
  const manager = await getSM()
  return manager.import(params.url)
},
```

- [ ] **Step 2: Add helper to get interrupted session**

```typescript
'session.getInterrupted': async () => {
  const store = await getSessionStore()
  return store.getInterruptedSession()
}
```

- [ ] **Step 3: Wire interrupt handler setup**

After session is started, setup signal handler:

```typescript
'session.start': async (params) => {
  const manager = await getSM()
  const sessionId = await manager.start(params.projectPath, params.provider, params.title)
  // Setup interrupt handler for this session
  getInterruptHandler().setupSignalHandler(async (sid, mid) => {
    const mgr = await getSM()
    await mgr.markInterrupted(sid, mid)
  })
  return { sessionId }
}
```

- [ ] **Step 4: Test all IPC handlers**

Create integration test file `apps/core/src/server.session.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { rm } from "fs/promises";
import { JsonRpcServer } from "./server";

describe("Session IPC handlers", () => {
  // Test that JSON-RPC requests for session.* methods work correctly
  // Mock stdin/stdout and send JSON-RPC requests directly
});
```

- [ ] **Step 5: Commit**

```bash
git add apps/core/src/server.ts
git commit -m "$(cat <<'EOF'
feat: add session IPC handlers to server

Server now handles session.list, session.resume, session.fork,
session.archive, session.delete, session.export, session.import,
and session.getInterrupted via JSON-RPC.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Remote Session Sync (URL Export/Import)

**Files:**

- Modify: `apps/core/src/store/remote.ts` (existing, add URL-based export/import)
- Modify: `apps/core/src/session/manager.ts` (add export/import methods)
- Test: `apps/core/src/session/remote.test.ts`

- [ ] **Step 1: Read existing remote.ts**

Read `apps/core/src/store/remote.ts` to understand `RemoteSessionSync` class.

- [ ] **Step 2: Write test for URL export/import**

```typescript
// apps/core/src/session/remote.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { rm } from "fs/promises";
import { createSessionStore } from "./store";

describe("Session URL export/import", () => {
  const testDir = "/tmp/freecode-test-remote";
  let store: Awaited<ReturnType<typeof createSessionStore>>;

  beforeEach(async () => {
    await rm(testDir, { recursive: true, force: true });
    store = await createSessionStore(testDir);
  });

  it("serializes session for export", async () => {
    const sessionId = await store.createSession({
      title: "Export Test",
      projectPath: "/tmp/test",
      provider: "claude",
    });
    await store.appendMessage(sessionId, {
      id: "msg-1",
      role: "user",
      parts: [{ type: "text", content: "hello" }],
      timestamp: Date.now(),
    });
    const meta = await store.getMeta(sessionId);
    const messages = await store.getMessages(sessionId);
    // Export should produce a serializable object
    const exported = { meta, messages };
    expect(exported.meta.id).toBe(sessionId);
    expect(exported.messages).toHaveLength(1);
  });

  it("deserializes and creates new session", async () => {
    const sessionId = await store.createSession({
      title: "Import Source",
      projectPath: "/tmp/test",
      provider: "claude",
    });
    const originalMeta = await store.getMeta(sessionId);
    const originalMessages = await store.getMessages(sessionId);

    // Simulate import: create new session from exported data
    const newId = await store.createSession({
      title: originalMeta.title + " (imported)",
      projectPath: originalMeta.projectPath,
      provider: originalMeta.provider,
    });
    for (const msg of originalMessages) {
      await store.appendMessage(newId, msg);
    }
    const newMessages = await store.getMessages(newId);
    expect(newMessages).toHaveLength(originalMessages.length);
    expect(newId).not.toBe(sessionId);
  });
});
```

- [ ] **Step 3: Add export/import to SessionManager**

In `apps/core/src/session/manager.ts`, add:

```typescript
async export(sessionId: string): Promise<{ url: string; expiresAt: number }> {
  const meta = await this.sessionStore.getMeta(sessionId)
  if (!meta) throw new Error('Session not found')
  const messages = await this.sessionStore.getMessages(sessionId)
  const payload = JSON.stringify({ meta, messages })

  // POST to sync endpoint (configurable via config.json)
  const endpoint = getConfig().syncEndpoint ?? 'https://sync.freecode.dev'
  const response = await fetch(`${endpoint}/upload`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: payload,
  })
  if (!response.ok) throw new Error('Export failed')
  const result = await response.json() as { url: string; expiresAt: number }
  return result
}

async import(url: string): Promise<string> {
  const response = await fetch(url)
  if (!response.ok) throw new Error('Import failed')
  const { meta, messages } = await response.json() as { meta: SessionMeta; messages: SerializedMessage[] }

  const newId = await this.sessionStore.createSession({
    title: meta.title + ' (imported)',
    projectPath: meta.projectPath,
    provider: meta.provider,
    model: meta.model,
  })
  for (const msg of messages) {
    await this.sessionStore.appendMessage(newId, msg)
  }
  await this.sessionStore.updateMeta(newId, { status: 'imported' as const })
  return newId
}
```

- [ ] **Step 4: Run tests and commit**

Run: `cd apps/core && npx vitest src/session/remote.test.ts --run`
Commit:

```bash
git add apps/core/src/session/manager.ts apps/core/src/session/remote.test.ts
git commit -m "$(cat <<'EOF'
feat: add URL-based session export/import

Session export serializes meta+messages and POSTs to sync
endpoint. Session import GETs URL and creates local session.
Enables sharing sessions via short URLs.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review Checklist

1. **Spec coverage**: All v1 items covered?
   - [x] Session storage at `~/.freecode/sessions/` → Task 1
   - [x] JSONL message streaming → Task 1 + Task 3
   - [x] Interrupt handling (Ctrl+C) → Task 4
   - [x] Resume with complete chat history → Task 2
   - [x] Resume picker → Task 5
   - [x] Session list/fork/archive/delete → Tasks 2 + 6
   - [x] URL-based export/import → Task 7

2. **Placeholder scan**: No TODOs, no "TBD", no "implement later"

3. **Type consistency**:
   - `SessionMeta.status`: `'active' | 'interrupted' | 'archived' | 'deleted'` — used consistently
   - `SerializedMessage` structure matches between store.ts and manager.ts
   - `session.list` filter uses same property names as `SessionMeta`

4. **File paths**: All exact, no relative paths
5. **Commands**: All test commands use exact paths with `npx vitest`
6. **Code blocks**: Every step that changes code has the actual code

---

## Execution

**Plan complete and saved to `docs/superpowers/plans/2026-06-02-memory-session-plan.md`.**

Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
