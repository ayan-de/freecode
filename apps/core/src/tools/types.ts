export interface ToolContext {
  cwd: string;
  sessionId?: string;
  abort?: AbortSignal;
  /**
   * Id of the tool call being served. Set by the loop so a long-running tool
   * can stream partial output back to the frontend against the row the user is
   * already looking at (see the live tail in `bash.ts`).
   */
  toolCallId?: string;
  projectPath?: string;
  /**
   * The spawning loop's agent mode. Only the `agent` tool reads it, to decide
   * what a subagent inherits — a subagent that silently dropped to `build`
   * under a `danger` parent prompted for permissions the user had already
   * turned off, in the middle of somebody else's turn.
   */
  agentMode?: import("../agent/types.js").AgentMode;
  fileCache?: FileCache;
  permissionProfile?: PermissionProfile;
  hooks?: unknown;
  startTime?: number;
}

// =============================================================================
// File Cache for LRU caching of file reads
// =============================================================================

export interface FileCacheEntry {
  content: string;
  stat: { mtime: number; size: number };
  lineCount?: number;
}

export interface FileCache {
  get(path: string): FileCacheEntry | undefined;
  set(path: string, entry: FileCacheEntry): void;
  invalidate(path: string): void;
  clear(): void;
}

// =============================================================================
// Permission Profile
// =============================================================================

export interface PermissionProfile {
  allow: string[];
  deny: string[];
  alwaysAsk: string[];
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

export interface JsonSchemaProperty {
  description?: string;
  type?: string;
  enum?: string[];
  items?: JsonSchemaProperty | JsonSchemaProperty[]; // For array items
}

export interface JsonSchema {
  type: string;
  properties?: Record<string, JsonSchemaProperty>;
  required?: string[];
  items?: JsonSchemaProperty | JsonSchemaProperty[]; // For array types
}
