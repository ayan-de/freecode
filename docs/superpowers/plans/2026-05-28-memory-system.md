# Memory System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement session memory compaction so long-running FreeCode sessions keep useful prior context without overflowing provider context windows.

**Architecture:** The CLI owns memory. `AgentLoop` records each turn, builds provider prompts from project context plus compacted session context, and triggers compaction after a turn when the estimated prompt size crosses the provider budget. Compaction summarizes older messages into an anchored continuation summary, preserves a recent tail, and uses the existing `PreCompact`/`PostCompact` hooks.

**Tech Stack:** TypeScript, Node built-in test runner through `tsx --test`, JSON file persistence under `.freecode/sessions`, existing CLI hook runtime.

---

## Current Repo Facts

- Frontends stay thin. All memory logic belongs in `apps/core`.
- `AgentLoop` currently sends only project context plus the current prompt to the provider. Memory must be wired into prompt construction or it will not affect context usage.
- `apps/core/src/hooks/runtime.ts` already exposes `runPreCompact()` and `runPostCompact()`. Do not add a parallel `MemoryCompact` hook.
- `apps/core/package.json` has no test script today. Add one using existing `tsx`; do not add a new test framework unless a later task needs it.
- Do not put memory domain types in `apps/core/src/agent/types.ts` unless `AgentLoop` needs a small public status shape. Keep detailed memory contracts in `apps/core/src/memory/types.ts`.

## File Structure

```
apps/core/src/
├── memory/
│   ├── index.ts          # Public memory exports
│   ├── types.ts          # Memory message, summary, config, result contracts
│   ├── tokens.ts         # Token estimation and context budgets
│   ├── selector.ts       # Select old head for compaction and recent tail to preserve
│   ├── summarizer.ts     # Deterministic anchored summary generator
│   ├── storage.ts        # JSON file persistence
│   └── service.ts        # Memory orchestrator used by AgentLoop
├── agent/
│   └── loop.ts           # Build prompts from memory and trigger compaction
└── hooks/
    └── runtime.ts        # Existing hooks only; type-only import update if needed
```

## Acceptance Criteria

- A long session can compact old history into a summary and preserve recent messages.
- The next provider prompt includes the summary and preserved recent messages.
- Old compacted messages are not repeated after compaction.
- `PreCompact` can block compaction.
- `PostCompact` runs after successful compaction.
- Memory state persists under `.freecode/sessions/<sessionId>/memory.json`.
- `pnpm --filter @freecode/core test` and `pnpm --filter @freecode/core lint` pass.

---

## Task 1: Test Harness And Memory Types

**Files:**
- Modify: `apps/core/package.json`
- Create: `apps/core/src/memory/types.ts`
- Create: `apps/core/src/memory/index.ts`

- [ ] **Step 1: Add a core test script**

In `apps/core/package.json`, add the `test` script:

```json
{
  "scripts": {
    "dev": "tsx src/index.ts",
    "build": "tsc",
    "lint": "tsc --noEmit",
    "test": "tsx --test \"src/**/*.test.ts\""
  }
}
```

- [ ] **Step 2: Run the empty test command**

Run: `pnpm --filter @freecode/core test`

Expected: command succeeds with no test files found or zero tests run.

- [ ] **Step 3: Create memory contracts**

Create `apps/core/src/memory/types.ts`:

```typescript
export type MemoryRole = "system" | "user" | "assistant"

export interface MemoryMessage {
  id: string
  role: MemoryRole
  content: string
  timestamp: number
  tokenCount: number
}

export interface CompactionSummary {
  id: string
  createdAt: number
  originalMessageCount: number
  originalTokenCount: number
  summaryTokenCount: number
  content: string
}

export interface MemoryState {
  sessionId: string
  messages: MemoryMessage[]
  summaries: CompactionSummary[]
  tokenCount: number
  totalCompactions: number
  lastCompactionAt?: number
}

export interface CompactionConfig {
  autoCompactBufferTokens: number
  warningBufferTokens: number
  preserveRecentTurns: number
  minPreserveRecentTokens: number
  maxPreserveRecentTokens: number
  maxToolOutputChars: number
}

export interface SelectionResult {
  summarize: MemoryMessage[]
  preserve: MemoryMessage[]
  summarizeTokenCount: number
  preserveTokenCount: number
}

export interface CompactionResult {
  success: boolean
  blocked?: boolean
  reason?: string
  summary?: CompactionSummary
  preservedMessageIds: string[]
  compactedMessageIds: string[]
  tokenCountBefore: number
  tokenCountAfter: number
}

export interface PromptMemoryContext {
  summary?: string
  recentMessages: MemoryMessage[]
  tokenCount: number
}

export const DEFAULT_COMPACTION_CONFIG: CompactionConfig = {
  autoCompactBufferTokens: 13_000,
  warningBufferTokens: 20_000,
  preserveRecentTurns: 2,
  minPreserveRecentTokens: 2_000,
  maxPreserveRecentTokens: 8_000,
  maxToolOutputChars: 2_000,
}
```

- [ ] **Step 4: Create public exports**

Create `apps/core/src/memory/index.ts`:

```typescript
export * from "./types.js"
```

- [ ] **Step 5: Type check**

Run: `pnpm --filter @freecode/core lint`

Expected: no TypeScript errors.

- [ ] **Step 6: Commit**

```bash
git add apps/core/package.json apps/core/src/memory/types.ts apps/core/src/memory/index.ts
git commit -m "feat(memory): add memory contracts"
```

---

## Task 2: Token Budgets

**Files:**
- Create: `apps/core/src/memory/tokens.ts`
- Create: `apps/core/src/memory/tokens.test.ts`
- Modify: `apps/core/src/memory/index.ts`

- [ ] **Step 1: Write failing token tests**

Create `apps/core/src/memory/tokens.test.ts`:

```typescript
import test from "node:test"
import assert from "node:assert/strict"
import { estimateTokenCount, getContextLimit, getAutoCompactThreshold, shouldCompact } from "./tokens.js"

test("estimateTokenCount uses a conservative char estimate", () => {
  assert.equal(estimateTokenCount("Hello World"), 3)
})

test("getContextLimit falls back for unknown models", () => {
  assert.equal(getContextLimit("unknown-model"), 100_000)
})

test("getAutoCompactThreshold reserves compaction buffer", () => {
  assert.equal(getAutoCompactThreshold("gpt-4o", 13_000), 115_000)
})

test("shouldCompact is true only at or above threshold", () => {
  assert.equal(shouldCompact(114_999, "gpt-4o", 13_000), false)
  assert.equal(shouldCompact(115_000, "gpt-4o", 13_000), true)
})
```

- [ ] **Step 2: Verify the test fails**

Run: `pnpm --filter @freecode/core test src/memory/tokens.test.ts`

Expected: FAIL because `tokens.ts` does not exist.

- [ ] **Step 3: Implement token helpers**

Create `apps/core/src/memory/tokens.ts`:

```typescript
const CHARS_PER_TOKEN = 4

export const MODEL_CONTEXT_LIMITS: Record<string, number> = {
  "gpt-4o": 128_000,
  "gpt-4-turbo": 128_000,
  "gpt-4": 8_192,
  "gpt-3.5-turbo": 16_385,
  "claude-3-5-sonnet": 200_000,
  "claude-3-opus": 200_000,
  "claude-3-sonnet": 200_000,
  "gemini-1.5-pro": 1_000_000,
  "gemini-1.5-flash": 1_000_000,
  default: 100_000,
}

export function estimateTokenCount(text: string): number {
  if (text.length === 0) return 0
  return Math.ceil(text.length / CHARS_PER_TOKEN)
}

export function getContextLimit(model: string): number {
  return MODEL_CONTEXT_LIMITS[model] ?? MODEL_CONTEXT_LIMITS.default
}

export function getAutoCompactThreshold(model: string, bufferTokens: number): number {
  return Math.max(0, getContextLimit(model) - bufferTokens)
}

export function shouldCompact(tokenCount: number, model: string, bufferTokens: number): boolean {
  return tokenCount >= getAutoCompactThreshold(model, bufferTokens)
}
```

- [ ] **Step 4: Export helpers**

Update `apps/core/src/memory/index.ts`:

```typescript
export * from "./types.js"
export * from "./tokens.js"
```

- [ ] **Step 5: Run tests and type check**

Run: `pnpm --filter @freecode/core test src/memory/tokens.test.ts`

Expected: PASS.

Run: `pnpm --filter @freecode/core lint`

Expected: no TypeScript errors.

- [ ] **Step 6: Commit**

```bash
git add apps/core/src/memory/index.ts apps/core/src/memory/tokens.ts apps/core/src/memory/tokens.test.ts
git commit -m "feat(memory): add token budget helpers"
```

---

## Task 3: Message Selection And Prompt Rendering

**Files:**
- Create: `apps/core/src/memory/selector.ts`
- Create: `apps/core/src/memory/selector.test.ts`
- Modify: `apps/core/src/memory/index.ts`

- [ ] **Step 1: Write failing selector tests**

Create `apps/core/src/memory/selector.test.ts`:

```typescript
import test from "node:test"
import assert from "node:assert/strict"
import { selectForCompaction, renderPromptMemoryContext } from "./selector.js"
import { DEFAULT_COMPACTION_CONFIG, type CompactionSummary, type MemoryMessage } from "./types.js"

function msg(id: string, role: MemoryMessage["role"], content: string, tokenCount = 100): MemoryMessage {
  return { id, role, content, tokenCount, timestamp: Number(id) }
}

test("selectForCompaction preserves the recent tail and summarizes older messages", () => {
  const messages = [
    msg("1", "user", "old request"),
    msg("2", "assistant", "old answer"),
    msg("3", "user", "middle request"),
    msg("4", "assistant", "middle answer"),
    msg("5", "user", "latest request"),
    msg("6", "assistant", "latest answer"),
  ]

  const result = selectForCompaction(messages, DEFAULT_COMPACTION_CONFIG)

  assert.deepEqual(result.summarize.map((item) => item.id), ["1", "2"])
  assert.deepEqual(result.preserve.map((item) => item.id), ["3", "4", "5", "6"])
})

test("selectForCompaction returns no summarize set when history is too short", () => {
  const messages = [msg("1", "user", "latest"), msg("2", "assistant", "answer")]
  const result = selectForCompaction(messages, DEFAULT_COMPACTION_CONFIG)

  assert.deepEqual(result.summarize, [])
  assert.deepEqual(result.preserve.map((item) => item.id), ["1", "2"])
})

test("renderPromptMemoryContext includes summary and recent messages", () => {
  const summary: CompactionSummary = {
    id: "summary-1",
    createdAt: 1,
    originalMessageCount: 2,
    originalTokenCount: 200,
    summaryTokenCount: 50,
    content: "## Goal\n- Build memory",
  }

  const rendered = renderPromptMemoryContext({
    summary: summary.content,
    recentMessages: [msg("3", "user", "continue work"), msg("4", "assistant", "working")],
    tokenCount: 250,
  })

  assert.match(rendered, /Compacted session summary/)
  assert.match(rendered, /Build memory/)
  assert.match(rendered, /Recent session messages/)
  assert.match(rendered, /user: continue work/)
})
```

- [ ] **Step 2: Verify the test fails**

Run: `pnpm --filter @freecode/core test src/memory/selector.test.ts`

Expected: FAIL because `selector.ts` does not exist.

- [ ] **Step 3: Implement selection and rendering**

Create `apps/core/src/memory/selector.ts`:

```typescript
import type { CompactionConfig, MemoryMessage, PromptMemoryContext, SelectionResult } from "./types.js"

function countTokens(messages: MemoryMessage[]): number {
  return messages.reduce((sum, message) => sum + message.tokenCount, 0)
}

function countUserTurns(messages: MemoryMessage[]): number {
  return messages.filter((message) => message.role === "user").length
}

export function selectForCompaction(messages: MemoryMessage[], config: CompactionConfig): SelectionResult {
  if (countUserTurns(messages) <= config.preserveRecentTurns) {
    return {
      summarize: [],
      preserve: [...messages],
      summarizeTokenCount: 0,
      preserveTokenCount: countTokens(messages),
    }
  }

  let userTurnsSeen = 0
  let preserveStart = messages.length

  for (let index = messages.length - 1; index >= 0; index--) {
    if (messages[index].role === "user") {
      userTurnsSeen++
      if (userTurnsSeen === config.preserveRecentTurns) {
        preserveStart = index
        break
      }
    }
  }

  let preserve = messages.slice(preserveStart)
  while (countTokens(preserve) > config.maxPreserveRecentTokens && preserve.length > 1) {
    preserve = preserve.slice(1)
  }

  const firstPreservedId = preserve[0]?.id
  const firstPreservedIndex = firstPreservedId ? messages.findIndex((message) => message.id === firstPreservedId) : messages.length
  const summarize = messages.slice(0, Math.max(0, firstPreservedIndex))

  return {
    summarize,
    preserve,
    summarizeTokenCount: countTokens(summarize),
    preserveTokenCount: countTokens(preserve),
  }
}

export function renderPromptMemoryContext(context: PromptMemoryContext): string {
  const sections: string[] = []

  if (context.summary) {
    sections.push("Compacted session summary:")
    sections.push(context.summary)
  }

  if (context.recentMessages.length > 0) {
    sections.push("Recent session messages:")
    for (const message of context.recentMessages) {
      sections.push(`${message.role}: ${message.content}`)
    }
  }

  return sections.join("\n\n")
}
```

- [ ] **Step 4: Export selector**

Update `apps/core/src/memory/index.ts`:

```typescript
export * from "./types.js"
export * from "./tokens.js"
export * from "./selector.js"
```

- [ ] **Step 5: Run tests and type check**

Run: `pnpm --filter @freecode/core test src/memory/selector.test.ts`

Expected: PASS.

Run: `pnpm --filter @freecode/core lint`

Expected: no TypeScript errors.

- [ ] **Step 6: Commit**

```bash
git add apps/core/src/memory/index.ts apps/core/src/memory/selector.ts apps/core/src/memory/selector.test.ts
git commit -m "feat(memory): select compacted history"
```

---

## Task 4: Anchored Summarizer

**Files:**
- Create: `apps/core/src/memory/summarizer.ts`
- Create: `apps/core/src/memory/summarizer.test.ts`
- Modify: `apps/core/src/memory/index.ts`

- [ ] **Step 1: Write failing summarizer tests**

Create `apps/core/src/memory/summarizer.test.ts`:

```typescript
import test from "node:test"
import assert from "node:assert/strict"
import { summarizeMessages } from "./summarizer.js"
import type { MemoryMessage } from "./types.js"

function msg(id: string, role: MemoryMessage["role"], content: string): MemoryMessage {
  return { id, role, content, tokenCount: Math.ceil(content.length / 4), timestamp: Number(id) }
}

test("summarizeMessages creates an anchored continuation summary", () => {
  const summary = summarizeMessages({
    sessionId: "session-1",
    previousSummary: undefined,
    messages: [
      msg("1", "user", "Add memory compaction to apps/core/src/agent/loop.ts"),
      msg("2", "assistant", "Implemented selector and storage"),
    ],
  })

  assert.match(summary.content, /## Goal/)
  assert.match(summary.content, /memory compaction/)
  assert.match(summary.content, /## Recent Progress/)
  assert.equal(summary.originalMessageCount, 2)
})

test("summarizeMessages carries previous summary forward", () => {
  const summary = summarizeMessages({
    sessionId: "session-1",
    previousSummary: "## Goal\n- Build memory safely",
    messages: [msg("3", "user", "Now wire it into prompts")],
  })

  assert.match(summary.content, /Previous Summary/)
  assert.match(summary.content, /Build memory safely/)
  assert.match(summary.content, /wire it into prompts/)
})
```

- [ ] **Step 2: Verify the test fails**

Run: `pnpm --filter @freecode/core test src/memory/summarizer.test.ts`

Expected: FAIL because `summarizer.ts` does not exist.

- [ ] **Step 3: Implement deterministic summary generation**

Create `apps/core/src/memory/summarizer.ts`:

```typescript
import type { CompactionSummary, MemoryMessage } from "./types.js"
import { estimateTokenCount } from "./tokens.js"

interface SummarizeInput {
  sessionId: string
  previousSummary?: string
  messages: MemoryMessage[]
}

function clip(text: string, maxChars: number): string {
  return text.length <= maxChars ? text : `${text.slice(0, maxChars)}...`
}

export function summarizeMessages(input: SummarizeInput): CompactionSummary {
  const userMessages = input.messages.filter((message) => message.role === "user")
  const assistantMessages = input.messages.filter((message) => message.role === "assistant")
  const files = new Set<string>()

  for (const message of input.messages) {
    for (const match of message.content.matchAll(/(?:apps|packages|docs)\/[^\s)`'"]+/g)) {
      files.add(match[0])
    }
  }

  const lines = [
    "## Goal",
    `- ${clip(userMessages[0]?.content ?? "Continue the current coding session.", 240)}`,
    "",
    "## Previous Summary",
    input.previousSummary ? clip(input.previousSummary, 2_000) : "- (none)",
    "",
    "## Recent Progress",
    ...assistantMessages.slice(-5).map((message) => `- ${clip(message.content, 240)}`),
    assistantMessages.length === 0 ? "- (none)" : "",
    "",
    "## Relevant Files",
    ...([...files].slice(0, 20).map((file) => `- ${file}`)),
    files.size === 0 ? "- (none)" : "",
    "",
    "## Next Context",
    `- Preserved ${input.messages.length} older messages for continuation.`,
  ].filter((line) => line !== undefined)

  const content = lines.join("\n")
  const originalTokenCount = input.messages.reduce((sum, message) => sum + message.tokenCount, 0)

  return {
    id: `summary-${input.sessionId}-${Date.now()}`,
    createdAt: Date.now(),
    originalMessageCount: input.messages.length,
    originalTokenCount,
    summaryTokenCount: estimateTokenCount(content),
    content,
  }
}
```

- [ ] **Step 4: Export summarizer**

Update `apps/core/src/memory/index.ts`:

```typescript
export * from "./types.js"
export * from "./tokens.js"
export * from "./selector.js"
export * from "./summarizer.js"
```

- [ ] **Step 5: Run tests and type check**

Run: `pnpm --filter @freecode/core test src/memory/summarizer.test.ts`

Expected: PASS.

Run: `pnpm --filter @freecode/core lint`

Expected: no TypeScript errors.

- [ ] **Step 6: Commit**

```bash
git add apps/core/src/memory/index.ts apps/core/src/memory/summarizer.ts apps/core/src/memory/summarizer.test.ts
git commit -m "feat(memory): add anchored summarizer"
```

---

## Task 5: Storage And Memory Service

**Files:**
- Create: `apps/core/src/memory/storage.ts`
- Create: `apps/core/src/memory/service.ts`
- Create: `apps/core/src/memory/service.test.ts`
- Modify: `apps/core/src/memory/index.ts`

- [ ] **Step 1: Write failing service tests**

Create `apps/core/src/memory/service.test.ts`:

```typescript
import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createHookRuntime } from "../hooks/runtime.js"
import { FileMemoryStorage } from "./storage.js"
import { MemoryService } from "./service.js"

test("MemoryService compacts old messages and exposes prompt context", async () => {
  const dir = mkdtempSync(join(tmpdir(), "freecode-memory-"))
  try {
    const service = new MemoryService("session-1", {
      storage: new FileMemoryStorage(dir),
      hooks: createHookRuntime(),
    })

    service.addMessage("user", "old request in docs/superpowers/plans/x.md")
    service.addMessage("assistant", "old answer")
    service.addMessage("user", "middle request")
    service.addMessage("assistant", "middle answer")
    service.addMessage("user", "latest request")
    service.addMessage("assistant", "latest answer")

    const result = await service.compact()
    const context = service.getPromptContext()

    assert.equal(result.success, true)
    assert.ok(context.summary?.includes("old request"))
    assert.deepEqual(context.recentMessages.map((message) => message.content), [
      "middle request",
      "middle answer",
      "latest request",
      "latest answer",
    ])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("MemoryService respects PreCompact block", async () => {
  const hooks = {
    ...createHookRuntime(),
    async runPreCompact() {
      return { action: "block" as const, reason: "blocked by test" }
    },
  }

  const service = new MemoryService("session-1", { hooks })
  service.addMessage("user", "old request")
  service.addMessage("assistant", "old answer")
  service.addMessage("user", "latest request")
  service.addMessage("assistant", "latest answer")

  const result = await service.compact()

  assert.equal(result.success, false)
  assert.equal(result.blocked, true)
  assert.equal(result.reason, "blocked by test")
})
```

- [ ] **Step 2: Verify the test fails**

Run: `pnpm --filter @freecode/core test src/memory/service.test.ts`

Expected: FAIL because `storage.ts` and `service.ts` do not exist.

- [ ] **Step 3: Implement storage**

Create `apps/core/src/memory/storage.ts`:

```typescript
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import type { MemoryState } from "./types.js"

const SESSION_DIR = ".freecode/sessions"

export interface MemoryStorage {
  save(state: MemoryState): void
  load(sessionId: string): MemoryState | undefined
  listSessions(): string[]
  delete(sessionId: string): void
}

export class FileMemoryStorage implements MemoryStorage {
  constructor(private readonly basePath = process.cwd()) {}

  private sessionDir(sessionId: string): string {
    return join(this.basePath, SESSION_DIR, sessionId)
  }

  private memoryPath(sessionId: string): string {
    return join(this.sessionDir(sessionId), "memory.json")
  }

  save(state: MemoryState): void {
    mkdirSync(this.sessionDir(state.sessionId), { recursive: true })
    writeFileSync(this.memoryPath(state.sessionId), JSON.stringify(state, null, 2))
  }

  load(sessionId: string): MemoryState | undefined {
    const file = this.memoryPath(sessionId)
    if (!existsSync(file)) return undefined
    return JSON.parse(readFileSync(file, "utf8")) as MemoryState
  }

  listSessions(): string[] {
    const dir = join(this.basePath, SESSION_DIR)
    if (!existsSync(dir)) return []
    return readdirSync(dir).filter((entry) => statSync(join(dir, entry)).isDirectory())
  }

  delete(sessionId: string): void {
    rmSync(this.sessionDir(sessionId), { recursive: true, force: true })
  }
}
```

- [ ] **Step 4: Implement service**

Create `apps/core/src/memory/service.ts`:

```typescript
import type { HookRuntime } from "../hooks/runtime.js"
import { createHookRuntime } from "../hooks/runtime.js"
import { DEFAULT_COMPACTION_CONFIG, type CompactionConfig, type CompactionResult, type MemoryMessage, type MemoryRole, type MemoryState, type PromptMemoryContext } from "./types.js"
import { estimateTokenCount, shouldCompact } from "./tokens.js"
import { selectForCompaction } from "./selector.js"
import { summarizeMessages } from "./summarizer.js"
import { FileMemoryStorage, type MemoryStorage } from "./storage.js"

interface MemoryServiceOptions {
  config?: Partial<CompactionConfig>
  storage?: MemoryStorage
  hooks?: HookRuntime
}

export class MemoryService {
  private readonly config: CompactionConfig
  private readonly storage: MemoryStorage
  private readonly hooks: HookRuntime
  private state: MemoryState

  constructor(sessionId: string, options: MemoryServiceOptions = {}) {
    this.config = { ...DEFAULT_COMPACTION_CONFIG, ...options.config }
    this.storage = options.storage ?? new FileMemoryStorage()
    this.hooks = options.hooks ?? createHookRuntime()
    this.state = this.storage.load(sessionId) ?? {
      sessionId,
      messages: [],
      summaries: [],
      tokenCount: 0,
      totalCompactions: 0,
    }
  }

  addMessage(role: MemoryRole, content: string): MemoryMessage {
    const message: MemoryMessage = {
      id: `msg-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      role,
      content,
      timestamp: Date.now(),
      tokenCount: estimateTokenCount(content),
    }
    this.state.messages.push(message)
    this.state.tokenCount += message.tokenCount
    this.storage.save(this.state)
    return message
  }

  shouldCompact(model: string): boolean {
    return shouldCompact(this.state.tokenCount, model, this.config.autoCompactBufferTokens)
  }

  getPromptContext(): PromptMemoryContext {
    return {
      summary: this.state.summaries.at(-1)?.content,
      recentMessages: [...this.state.messages],
      tokenCount: this.state.tokenCount,
    }
  }

  async compact(): Promise<CompactionResult> {
    const selected = selectForCompaction(this.state.messages, this.config)
    if (selected.summarize.length === 0) {
      return {
        success: true,
        preservedMessageIds: selected.preserve.map((message) => message.id),
        compactedMessageIds: [],
        tokenCountBefore: this.state.tokenCount,
        tokenCountAfter: this.state.tokenCount,
      }
    }

    const pre = await this.hooks.runPreCompact({
      sessionId: this.state.sessionId,
      turnCount: this.state.totalCompactions,
      tokenCount: this.state.tokenCount,
    })
    if (pre.action === "block") {
      return {
        success: false,
        blocked: true,
        reason: pre.reason,
        preservedMessageIds: this.state.messages.map((message) => message.id),
        compactedMessageIds: [],
        tokenCountBefore: this.state.tokenCount,
        tokenCountAfter: this.state.tokenCount,
      }
    }

    const previousSummary = this.state.summaries.at(-1)?.content
    const summary = summarizeMessages({
      sessionId: this.state.sessionId,
      previousSummary,
      messages: selected.summarize,
    })

    const tokenCountAfter = summary.summaryTokenCount + selected.preserveTokenCount
    const result: CompactionResult = {
      success: true,
      summary,
      preservedMessageIds: selected.preserve.map((message) => message.id),
      compactedMessageIds: selected.summarize.map((message) => message.id),
      tokenCountBefore: this.state.tokenCount,
      tokenCountAfter,
    }

    this.state = {
      ...this.state,
      messages: selected.preserve,
      summaries: [...this.state.summaries, summary],
      tokenCount: tokenCountAfter,
      totalCompactions: this.state.totalCompactions + 1,
      lastCompactionAt: Date.now(),
    }
    this.storage.save(this.state)
    await this.hooks.runPostCompact({
      sessionId: this.state.sessionId,
      turnCount: this.state.totalCompactions,
      tokenCount: this.state.tokenCount,
      compactedMessageIds: result.compactedMessageIds,
    })

    return result
  }
}
```

- [ ] **Step 5: Export service and storage**

Update `apps/core/src/memory/index.ts`:

```typescript
export * from "./types.js"
export * from "./tokens.js"
export * from "./selector.js"
export * from "./summarizer.js"
export * from "./storage.js"
export * from "./service.js"
```

- [ ] **Step 6: Run tests and type check**

Run: `pnpm --filter @freecode/core test src/memory/service.test.ts`

Expected: PASS.

Run: `pnpm --filter @freecode/core lint`

Expected: no TypeScript errors.

- [ ] **Step 7: Commit**

```bash
git add apps/core/src/memory/index.ts apps/core/src/memory/storage.ts apps/core/src/memory/service.ts apps/core/src/memory/service.test.ts
git commit -m "feat(memory): add memory service"
```

---

## Task 6: Integrate Memory Into AgentLoop Prompts

**Files:**
- Modify: `apps/core/src/agent/loop.ts`
- Create: `apps/core/src/agent/loop-memory.test.ts`

- [ ] **Step 1: Write failing prompt integration test**

Create `apps/core/src/agent/loop-memory.test.ts`:

```typescript
import test from "node:test"
import assert from "node:assert/strict"
import { renderPromptMemoryContext } from "../memory/selector.js"

test("rendered memory context is suitable for AgentLoop prompt insertion", () => {
  const rendered = renderPromptMemoryContext({
    summary: "## Goal\n- Build memory",
    recentMessages: [
      { id: "1", role: "user", content: "latest request", timestamp: 1, tokenCount: 10 },
      { id: "2", role: "assistant", content: "latest answer", timestamp: 2, tokenCount: 10 },
    ],
    tokenCount: 20,
  })

  assert.match(rendered, /Compacted session summary/)
  assert.match(rendered, /Recent session messages/)
  assert.match(rendered, /latest request/)
})
```

- [ ] **Step 2: Update AgentLoop imports and fields**

In `apps/core/src/agent/loop.ts`, add:

```typescript
import { MemoryService, renderPromptMemoryContext } from "../memory/index.js"
```

Add a private field:

```typescript
private memory: MemoryService
```

In the constructor, after `this.state = createInitialSessionState(sessionId)`:

```typescript
this.memory = new MemoryService(sessionId)
```

- [ ] **Step 3: Change executeTurn signature**

Change:

```typescript
const turnResult = await this.executeTurn(prompt, contextResult.value)
```

To:

```typescript
const turnResult = await this.executeTurn(prompt, input.provider, contextResult.value)
```

Change the method signature:

```typescript
private async executeTurn(
  prompt: string,
  provider: string,
  context: { name: string; projectPath: string; tree: string }
): Promise<{ success: boolean; toolResults: ToolResult[]; responseText?: string; error?: string }>
```

- [ ] **Step 4: Build provider prompts from memory**

In `executeTurn()`, replace the current `fullPrompt` construction with:

```typescript
const memoryContext = renderPromptMemoryContext(this.memory.getPromptContext())
const fullPrompt = `Project: ${context.name}
Path: ${context.projectPath}

File tree:
${context.tree}

${memoryContext ? `Session context:\n${memoryContext}\n\n` : ""}Task: ${prompt}`
```

- [ ] **Step 5: Record messages and compact after each turn**

After `const responseText = await this.sendToProvider(fullPrompt)`, keep parsing as-is.

Before returning from successful `executeTurn()`, add:

```typescript
this.memory.addMessage("user", prompt)
this.memory.addMessage("assistant", responseText)

if (this.memory.shouldCompact(provider)) {
  const result = await this.memory.compact()
  if (!result.success) {
    console.warn(`[AgentLoop] Memory compaction skipped: ${result.reason ?? "unknown reason"}`)
  }
}

return { success: true, toolResults, responseText }
```

Make sure the no-tool branch also records and compacts before returning:

```typescript
if (toolCalls.length === 0) {
  this.memory.addMessage("user", prompt)
  this.memory.addMessage("assistant", responseText)
  if (this.memory.shouldCompact(provider)) {
    await this.memory.compact()
  }
  return { success: true, toolResults: [], responseText }
}
```

- [ ] **Step 6: Run tests and type check**

Run: `pnpm --filter @freecode/core test src/agent/loop-memory.test.ts`

Expected: PASS.

Run: `pnpm --filter @freecode/core lint`

Expected: no TypeScript errors.

- [ ] **Step 7: Commit**

```bash
git add apps/core/src/agent/loop.ts apps/core/src/agent/loop-memory.test.ts
git commit -m "feat(agent): include memory in provider prompts"
```

---

## Task 7: Tool Output Pruning

**Files:**
- Modify: `apps/core/src/memory/service.ts`
- Create: `apps/core/src/memory/pruning.test.ts`

- [ ] **Step 1: Write failing pruning test**

Create `apps/core/src/memory/pruning.test.ts`:

```typescript
import test from "node:test"
import assert from "node:assert/strict"
import { MemoryService } from "./service.js"

test("assistant tool-like output is capped before storage", () => {
  const service = new MemoryService("session-prune", {
    config: { maxToolOutputChars: 20 },
  })

  service.addMessage("assistant", `Tool read: ${"x".repeat(100)}`)
  const context = service.getPromptContext()

  assert.ok(context.recentMessages[0].content.length < 80)
  assert.match(context.recentMessages[0].content, /truncated/)
})
```

- [ ] **Step 2: Verify the test fails**

Run: `pnpm --filter @freecode/core test src/memory/pruning.test.ts`

Expected: FAIL because `addMessage()` stores full content.

- [ ] **Step 3: Cap tool-like assistant content**

In `apps/core/src/memory/service.ts`, add:

```typescript
private normalizeContent(role: MemoryRole, content: string): string {
  if (role !== "assistant") return content
  if (!content.startsWith("Tool ")) return content
  if (content.length <= this.config.maxToolOutputChars) return content
  return `${content.slice(0, this.config.maxToolOutputChars)}\n[tool output truncated for memory]`
}
```

In `addMessage()`, before calculating tokens:

```typescript
const normalizedContent = this.normalizeContent(role, content)
```

Use `normalizedContent` for `content` and `estimateTokenCount(normalizedContent)`.

- [ ] **Step 4: Run tests and type check**

Run: `pnpm --filter @freecode/core test src/memory/pruning.test.ts src/memory/service.test.ts`

Expected: PASS.

Run: `pnpm --filter @freecode/core lint`

Expected: no TypeScript errors.

- [ ] **Step 5: Commit**

```bash
git add apps/core/src/memory/service.ts apps/core/src/memory/pruning.test.ts
git commit -m "feat(memory): cap stored tool output"
```

---

## Final Verification

- [ ] **Step 1: Run all core tests**

Run: `pnpm --filter @freecode/core test`

Expected: all tests pass.

- [ ] **Step 2: Run core type check**

Run: `pnpm --filter @freecode/core lint`

Expected: no TypeScript errors.

- [ ] **Step 3: Run repo build**

Run: `pnpm build`

Expected: build completes successfully.

---

## Self-Review Notes

- Spec coverage: detection, selection, summarization, preservation, hooks, persistence, and prompt reinjection are all covered.
- Type consistency: detailed memory contracts live in `apps/core/src/memory/types.ts`; `AgentLoop` consumes only `MemoryService` and `renderPromptMemoryContext`.
- Hook consistency: uses existing `runPreCompact` and `runPostCompact`; no duplicate memory hook is introduced.
- Test consistency: uses the existing `tsx` dependency and Node built-in tests.

Plan complete and saved to `docs/superpowers/plans/2026-05-28-memory-system.md`.

Two execution options:

**1. Subagent-Driven (recommended)** - dispatch a fresh worker per task, review between tasks, fast iteration.

**2. Inline Execution** - execute tasks in this session using executing-plans, with checkpoints after each task.
