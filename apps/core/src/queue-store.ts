// =============================================================================
// message-queue — in-memory FIFO queue of pending session.send submissions.
//
// Spec: docs/superpowers/specs/2026-08-05-queued-messages-design.md
//
// Lives alongside activeLoops in server.ts and answers four questions:
//   1. is this session currently busy? (server.ts calls enqueueIfBusy)
//   2. pull the next message to send when the active turn finishes (shiftNext)
//   3. remove a specific queued message by id (removeById — for dequeue IPC)
//   4. drop everything for a session on session.delete (clear)
//
// Pure module: no I/O, no shared state with other modules, no dependencies.
// server.ts owns the singleton instance; tests construct one per test.
// =============================================================================

import { randomUUID } from "crypto";

/** A user-submitted prompt that arrived while a turn was already running. */
export interface QueuedMessage {
  /** Stable across dequeue/UI lookups; assigned at enqueue time. */
  id: string;
  /** The raw prompt body — sent verbatim when the turn comes up. */
  content: string;
}

export interface MessageQueue {
  /** Append a new queued message; returns the generated id. */
  enqueue(content: string): string;
  /** FIFO: pull the oldest queued message, or undefined when empty. */
  shiftNext(): QueuedMessage | undefined;
  /** Remove the queued message with this id. Returns true if it was present. */
  removeById(id: string): boolean;
  /** Drop everything — used by session.delete. */
  clear(): void;
  /** Current depth (FIFO peek length) — exposed for tests. */
  size(): number;
}

/** Construct a per-session FIFO queue. Each session gets its own instance. */
export function createMessageQueue(): MessageQueue {
  const items: QueuedMessage[] = [];

  return {
    enqueue(content: string): string {
      const id = randomUUID();
      items.push({ id, content });
      return id;
    },
    shiftNext(): QueuedMessage | undefined {
      return items.shift();
    },
    removeById(id: string): boolean {
      const idx = items.findIndex((m) => m.id === id);
      if (idx === -1) return false;
      items.splice(idx, 1);
      return true;
    },
    clear(): void {
      items.length = 0;
    },
    size(): number {
      return items.length;
    },
  };
}