// =============================================================================
// Agent Types
// =============================================================================

import type { FileChange } from '../parser/types.js';

export interface AgentConfig {
  projectPath: string;
  provider: string;
}

export interface ExecutorOptions {
  prompt: string;
  provider: string;
  projectPath: string;
  contextOptions?: {
    maxDepth?: number;
    ignorePatterns?: string[];
  };
}

export interface AgentResult {
  success: boolean;
  summary?: string;
  filesCreated: number;
  errors: string[];
}

export interface StreamCallback {
  (event: StreamEvent): void;
}

export type StreamEvent =
  | { type: 'status'; content: string }
  | { type: 'text'; content: string }
  | { type: 'code'; content: string; language?: string }
  | { type: 'tool'; toolName: string; args: unknown }
  | { type: 'tool_result'; toolName: string; result: string }
  | { type: 'done'; content: string }
  | { type: 'error'; content: string };