import type { Message } from "../agent/types.js";

export interface ProviderInfo {
  id: string;
  name: string;
  defaultModel: string;
  supportsStreaming: boolean;
  supportsTools: boolean;
}

export interface ToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface SystemBlock {
  text: string;
  cache?: boolean;
}

export interface ExecuteOptions {
  prompt?: string;
  messages?: Message[];
  system?: string | SystemBlock[];
  model?: string;
  temperature?: number;
  maxTokens?: number;
  tools?: ToolDef[];
  toolResults?: Array<{
    toolCallId: string;
    result: string;
    name?: string;
    input?: Record<string, unknown>;
  }>;
  stream?: boolean;
  // Cancellation: callers (agent loop) pass an AbortSignal so in-flight
  // provider requests can be interrupted (Ctrl+C, session.stop).
  abortSignal?: AbortSignal;
}

export interface ExecuteResult {
  content: string;
  thinking?: string; // Extended thinking/reasoning content
  toolCalls?: Array<{
    name: string;
    args: Record<string, unknown>;
    id: string;
  }>;
  usage?: {
    inputTokens: number;
    outputTokens: number;
    cacheCreationInputTokens?: number;
    cacheReadInputTokens?: number;
  };
  stopReason: "stop" | "tool_use" | "max_tokens" | "unknown";
  provider: string;
  model: string;
}

export type ProviderChunk =
  | { type: "text_delta"; delta: string }
  | { type: "thinking_delta"; delta: string }
  | {
      type: "tool_call";
      id: string;
      name: string;
      args: Record<string, unknown>;
    }
  | {
      type: "usage";
      usage: NonNullable<ExecuteResult["usage"]>;
    }
  | { type: "done"; stopReason: ExecuteResult["stopReason"] }
  | { type: "error"; error: string };

export interface AIProvider {
  info: ProviderInfo;
  execute(opts: ExecuteOptions): Promise<ExecuteResult>;
  // Optional streaming API. When present and caller opts in, the provider
  // yields ProviderChunks as they arrive from the model. Callers that do not
  // implement streaming can continue to use execute() unchanged.
  stream?(opts: ExecuteOptions): AsyncIterable<ProviderChunk>;
}
