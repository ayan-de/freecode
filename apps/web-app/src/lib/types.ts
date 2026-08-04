import type { MessagePart as SharedMessagePart } from "@thisisayande/freecode-shared";

export type MessagePart =
  | SharedMessagePart
  | { type: "thinking"; content: string }
  // Spec §4.2 — events the server had already evicted when this client
  // reconnected. Rendered as an explicit marker, never silently dropped.
  | { type: "gap"; from: number; to: number };

export interface Message {
  id: string;
  role: "user" | "assistant";
  parts: MessagePart[];
  timestamp: number;
}
