import type { Component } from "@earendil-works/pi-tui";

export type MessageType =
  | "user"
  | "assistant"
  | "system"
  | "in_progress"
  | "tool"
  | "thinking"
  // Spec 2026-08-05: a prompt the user submitted while a turn was already
  // in progress. Renders like a user message but with a dimmed "queued"
  // marker; on `message_dequeued` the UI drops it (or restores to the
  // editor); once the turn actually starts the queued_user is upgraded in
  // place to a normal user message + the in-progress line.
  | "queued_user";

export interface MessageInstance {
  id: number;
  type: MessageType;
  content: string; // raw content for reference
  component: Component;
  timestamp: number; // also serves as startTime for in-progress messages
  /**
   * Server-assigned id for queued follow-up messages (spec 2026-08-05).
   * Undefined for every other message type. The `session.dequeue` IPC
   * targets this id, so the TUI keeps the round-trip stable even after
   * the local message-store id has rotated.
   */
  queueId?: string;
  /**
   * 1-based index of the user prompt this message belongs to. Set on every
   * user/queued_user message and inherited by every subsequent message
   * until the next user prompt. System messages and the in-progress line
   * that precedes the first user prompt have promptIndex === undefined.
   * Drives the inline "Prompt 2/2" label and Alt+Up/Down page navigation.
   */
  promptIndex?: number;
}

export interface MessageStoreOptions {
  maxMessages?: number; // optional cap for memory management
}
