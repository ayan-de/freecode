# Queued Messages

## Problem

Today, sending a message via `session.send` while a turn is already in progress is not blocked, queued, or rejected — it races. `apps/core/src/server.ts` (~L251-340) creates a new `AgentLoop` per `session.send` call and overwrites `activeLoops.get(sessionId)`, so two loop instances can concurrently mutate the same session's message history (`SessionServiceImpl.appendMessage`, a plain array push with no locking). The TUI editor (`apps/tui/src/index.ts:1043`) has no guard against submitting mid-turn either.

## Goal

When a user submits a message while the agent is mid-turn for that session, queue it instead of racing. Once the current turn finishes, automatically start the next turn using the oldest queued message (FIFO). Support multiple queued messages. A queued message can be pulled back out of the queue (removed, or restored to the editor for re-editing) before it's sent — matches the behavior in opencode/pi/claude-code, which all support this.

## Design

### Core (`apps/core/src/server.ts`)

- Add `const messageQueues = new Map<string, QueuedMessage[]>()` alongside the existing `activeLoops` map, where `QueuedMessage = { id: string; content: string }` (`id` via `crypto.randomUUID()`).
- In the `session.send` handler:
  - If `activeLoops.has(sessionId)` is true (a turn is already running for this session), create a `QueuedMessage`, push it onto `messageQueues.get(sessionId) ?? []`, and emit a `message_queued` stream event (with the generated `id`) instead of creating a new `AgentLoop`. Return immediately (no turn started).
  - Otherwise, proceed with the existing flow (create loop, run it).
- In the loop's `finally` block (where `activeLoops.delete(sessionId)` currently happens): before deleting, check `messageQueues.get(sessionId)`. If non-empty, `shift()` the next `QueuedMessage` off the queue and re-invoke the same send path (create a new `AgentLoop`, run it) for its `content` — do not clear busy state in between. If the queue is empty, delete as before.
- New IPC method `session.dequeue({ sessionId, id })`: removes the matching `QueuedMessage` from `messageQueues.get(sessionId)` by `id` (no-op if not found, e.g. it already started sending). Emits a `message_dequeued` stream event with the `id` so the UI can drop its indicator. Used both for plain removal and as the first step of "edit" (TUI restores the content to the editor after a successful dequeue).
- Images are out of scope for the queue (only plain `message: string` is queued) — matches the common case; queued sends with images can be added later if requested.

### Protocol (`packages/shared/src/ipc/protocol.ts`)

Add two variants to the `StreamEvent` union:

```typescript
| { type: "message_queued"; id: string; content: string }
| { type: "message_dequeued"; id: string }
```

`message_queued` is emitted once per queued message, on the same stream the original `session.send` call is listening on. `message_dequeued` is emitted on the stream in response to a `session.dequeue` call.

Add `session.dequeue` to `METHODS` in `protocol.ts`: params `{ sessionId: string; id: string }`, result `{ removed: boolean }`.

### TUI (`apps/tui/src/index.ts`)

- No change to editor input behavior — it already allows typing/submitting at any time; no lock is added.
- On `message_queued`, render the message in the transcript immediately (as a user message) with a dim/"queued" visual marker, keyed by its `id`, the same way a normal user message renders otherwise.
- When that message's turn actually starts (existing `tool_start` / `text_delta` / `thinking` events arrive for it), the marker is dropped and it renders as a normal in-flight user message — no new state machine needed, this falls out of the existing per-message rendering once the turn begins.
- Removing/editing a queued message: while its "queued" marker is showing, pressing a dedicated key (e.g. `Ctrl+Backspace` on the queued item, or a small `[x]`/`[edit]` affordance next to it — exact keybinding left to implementation, following existing TUI keybinding conventions) calls `session.dequeue({ sessionId, id })`.
  - Plain removal: on `message_dequeued`, drop the message from the transcript.
  - Edit: on `message_dequeued`, additionally repopulate the editor with the removed message's content (same as pi's "restore queued message to editor" behavior) so the user can revise and resubmit.
- Only the most recently queued item needs a keybinding path for v1 (matches "one thing to point at" — the last line typed); reaching further back into the queue to edit an older item can be done via the same mechanism if the TUI already supports selecting an arbitrary transcript message, otherwise defer.

### Out of scope

- VS Code and Web frontends: core protocol change benefits them, but no queued-badge/edit UI is added there in this pass.
- Reordering the queue.
- Queuing images.
- Cross-session queues (queue is per-`sessionId`, matching `activeLoops`'s existing keying).
- Mid-turn "steering" (injecting a message into the currently-running turn, as pi's `steeringQueue` does) — this spec only covers follow-up queuing (pi's `followUpQueue` equivalent).

## Testing

- One `test_*` (or equivalent) covering: send while busy → message lands in `messageQueues`, not a new concurrent loop; when the active loop finishes, the queued message is dequeued and a new loop starts for it; multiple queued messages drain in FIFO order; `session.dequeue` removes a queued message by `id` and a subsequent turn-completion does not send it.
