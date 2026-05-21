export interface ToolListItem {
  id: string;
  description: string;
}

export interface ToolCallResult {
  title: string;
  output: string;
  metadata?: Record<string, unknown>;
}

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  parts: MessagePart[];
  timestamp: number;
}

export type MessagePart =
  | { type: 'text'; content: string }
  | { type: 'code'; language: string; content: string }
  | { type: 'tool'; tool: { name: string; args: Record<string, unknown> }; result?: string };