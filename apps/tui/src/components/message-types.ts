import type { Component } from "@earendil-works/pi-tui";

export type MessageType = "user" | "assistant" | "system" | "in_progress";

export interface MessageInstance {
  id: number;
  type: MessageType;
  content: string;  // raw content for reference
  component: Component;
  timestamp: number;  // also serves as startTime for in-progress messages
}

export interface MessageStoreOptions {
  maxMessages?: number;  // optional cap for memory management
}