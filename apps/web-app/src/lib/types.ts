import type { MessagePart as SharedMessagePart } from "@thisisayande/freecode-shared";

export type MessagePart =
  | SharedMessagePart
  | { type: "thinking"; content: string };

export interface Message {
  id: string;
  role: "user" | "assistant";
  parts: MessagePart[];
  timestamp: number;
}
