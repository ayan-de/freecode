# Queued Messages

## Problem

Today, sending a message via `session.send` while a turn is already in progress is not blocked, queued, or rejected — it races. `apps/core/src/server.ts` (~L251-340) creates a new `AgentLoop` per `session.send` call and overwrites `activeLoops.get(sessionId)`, so two loop instances can concurrently mutate the same session's message history (`SessionServiceImpl.appendMessage`, a plain array push with no locking). The TUI editor (`apps/tui/src/index.ts:1043`) has no guard against submitting mid-turn either.

## Goal

When a user submits a message while the agent is mid-turn for that session, queue it instead of racing. Once the current turn finishes, automatically start the next turn using the oldest queued message (FIFO). Support multiple queued messages. No editing or removing an already-queued message (YAGNI — add `session.dequeue` later if needed).

## Design

### Core (`apps/core/src/server.ts`)

- Add `const messageQueues = new Map<string, string[]>()` alongside the existing `activeLoops` map.
- In the `session.send` handler:
  - If `activeLoops.has(sessionId)` is true (a turn is already running for this session), push the incoming message onto `messageQueues.get(sessionId) ?? []` and emit a `message_queued` stream event instead of creating a new `AgentLoop`. Return immediately (no turn started).
  - Otherwise, proceed with the existing flow (create loop, run it).
- In the loop's `finally` block (where `activeLoops.delete(sessionId)` currently happens): before deleting, check `messageQueues.get(sessionId)`. If non-empty, `shift()` the next message off the queue and re-invoke the same send path (create a new `AgentLoop`, run it) for that message — do not clear busy state in between. If the queue is empty, delete as before.
- Images are out of scope for the queue (only plain `message: string` is queued) — matches the common case; queued sends with images can be added later if requested.

### Protocol (`packages/shared/src/ipc/protocol.ts`)

Add one variant to the `StreamEvent` union:

```typescript
| { type: "message_queued"; content: string }
```

Emitted once per queued message, on the same stream the original `session.send` call is listening on.

### TUI (`apps/tui/src/index.ts`)

- No change to editor behavior — it already allows typing/submitting at any time; no lock is added.
- On `message_queued`, render the message in the transcript immediately (as a user message) with a dim/"queued" visual marker, the same way a normal user message renders otherwise.
- When that message's turn actually starts (existing `tool_start` / `text_delta` / `thinking` events arrive for it), the marker is dropped and it renders as a normal in-flight user message — no new state machine needed, this falls out of the existing per-message rendering once the turn begins.

### Out of scope

- VS Code and Web frontends: core protocol change benefits them, but no queued-badge UI is added there in this pass.
- Editing/removing/reordering queued messages.
- Queuing images.
- Cross-session queues (queue is per-`sessionId`, matching `activeLoops`'s existing keying).

## Testing

- One `test_*` (or equivalent) covering: send while busy → message lands in `messageQueues`, not a new concurrent loop; when the active loop finishes, the queued message is dequeued and a new loop starts for it; multiple queued messages drain in FIFO order.
