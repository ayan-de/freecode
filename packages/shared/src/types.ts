// =============================================================================
// Core Domain Types
// =============================================================================

export interface Message {
  id: string;
  role: "user" | "assistant";
  parts: MessagePart[];
  timestamp: number;
}

export type MessagePart =
  | { type: "text"; content: string }
  | { type: "code"; language: string; content: string }
  | {
      type: "tool";
      tool: { name: string; args: Record<string, unknown> };
      result?: string;
    };

// =============================================================================
// Tool Types
// =============================================================================

export interface ToolContext {
  cwd: string;
  abort?: AbortSignal;
}

export interface ToolResult {
  title: string;
  output: string;
  metadata?: Record<string, unknown>;
}

export interface ToolDef<P = unknown, R extends ToolResult = ToolResult> {
  id: string;
  description: string;
  parameters: JsonSchema;
  execute: (params: P, ctx: ToolContext) => Promise<R>;
}

export type ToolRegistry = Record<string, ToolDef>;

export interface JsonSchema {
  type: string;
  properties?: Record<string, { description?: string; type?: string }>;
  required?: string[];
}

export interface ToolListItem {
  id: string;
  description: string;
}

// =============================================================================
// File Change Types
// =============================================================================

export type FileChangeAction = "create" | "update" | "delete";

export interface FileChange {
  path: string;
  action: FileChangeAction;
  content?: string;
  diff?: string;
}

export interface DiffResult {
  path: string;
  action: FileChangeAction;
  diff: string;
  success: boolean;
  error?: string;
}

// =============================================================================
// Parser Types
// =============================================================================

export interface ParsedResponse {
  success: boolean;
  response?: {
    summary: string;
    changes: FileChange[];
    raw: string;
    parserUsed: string;
  };
  error?: string;
}

// =============================================================================
// Provider Types
// =============================================================================

export interface ProviderInfo {
  id: string;
  name: string;
  description: string;
}

export interface ProviderDefinition {
  id: string;
  name: string;
  adapter: unknown;
  config: {
    url: string;
  };
}

// =============================================================================
// Session Types
// =============================================================================

export interface SessionConfig {
  projectPath: string;
  provider?: string;
  agentMode?: "plan" | "build" | "review" | "explore" | "danger";
}

export interface SessionInfo {
  id: string;
  projectPath: string;
  provider: string;
  startedAt: number;
}
