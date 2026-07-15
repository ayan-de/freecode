// =============================================================================
// Tool Types - Rich Tool Interface for FreeCode
// PRIMARY: Define the rich Tool interface with UI rendering, permissions,
// validation, and behavior metadata
// Based on Claude Code's Tool interface architecture
// =============================================================================

import type { ToolContext } from "./types.js";

// =============================================================================
// ToolUseMessage - Discriminated union for UI rendering
// These messages are produced by tool UI methods and consumed by the TUI renderer
// =============================================================================

export type ToolUseMessage =
  | {
      type: "tool_use";
      toolId: string;
      args: Record<string, unknown>;
      status: "pending" | "running";
    }
  | {
      type: "tool_result";
      toolId: string;
      result: ToolResult;
      status: "success" | "error";
    }
  | { type: "tool_progress"; toolId: string; message: string; percent?: number }
  | { type: "tool_error"; toolId: string; error: string }
  | { type: "tool_rejected"; toolId: string; reason: string };

// =============================================================================
// ToolUI - UI rendering interface
// Each tool implements these methods to provide rich UI rendering
// =============================================================================

export interface ToolUI {
  // Render the tool invocation message (what shows when tool is called)
  renderToolUseMessage(
    toolId: string,
    args: Record<string, unknown>,
  ): ToolUseMessage;

  // Render the result of tool execution
  renderToolResultMessage(toolId: string, result: ToolResult): ToolUseMessage;

  // Render a short tag shown after tool name (e.g., "Read" or file count)
  renderToolUseTag(
    toolId: string,
    args?: Record<string, unknown>,
  ): { label: string; color: string };

  // Render progress during long-running operations
  renderToolUseProgressMessage(
    toolId: string,
    message: string,
    percent?: number,
  ): ToolUseMessage;

  // Render error state
  renderToolUseErrorMessage(toolId: string, error: string): ToolUseMessage;

  // Render rejection (permission denied, etc.)
  renderToolUseRejectedMessage(toolId: string, reason: string): ToolUseMessage;
}

// =============================================================================
// ToolBehavior - Metadata about tool behavior
// =============================================================================

export interface ToolBehavior {
  // Whether this tool can run concurrently with other tools
  isConcurrencySafe: boolean;
  // Whether this tool modifies files/system (affects confirmation prompts)
  isDestructive: boolean;
  // How to handle interruption while this tool is running
  interruptBehavior: "await" | "ignore" | "error";
  // Maximum result size in characters (results larger than this may be truncated)
  maxResultSizeChars: number;
  // Human-readable name for display in UI
  userFacingName: string;
}

// =============================================================================
// PermissionOperation - Types of operations that require permissions
// =============================================================================

export type PermissionOperation =
  | "file.read"
  | "file.write"
  | "file.delete"
  | "network"
  | "shell"
  | "subprocess"
  | "mcp"
  | "agent.spawn";

// =============================================================================
// ToolPermissions - Permission requirements for a tool
// =============================================================================

export interface ToolPermissions {
  operations: PermissionOperation[];
  // If true, always prompt user for approval even if tool is in allowlist
  requiresApproval: boolean;
}

// =============================================================================
// ToolExecutionResult - Discriminated union for tool execution results
// =============================================================================

export type ToolExecutionResult<R> =
  | { success: true; result: R }
  | { success: false; error: string; code?: string };

// =============================================================================
// ValidationResult - Result of input validation
// =============================================================================

export type ValidationResult =
  | { valid: true }
  | { valid: false; error: string; errorCode?: number };

// =============================================================================
// PermissionCheckResult - Result of permission check
// =============================================================================

export interface PermissionCheckResult {
  allowed: boolean;
  reason?: string;
  updatedInput?: Record<string, unknown>;
}

// =============================================================================
// Tool - Rich tool definition
// This is the main interface that all tools should implement
// =============================================================================

export interface Tool<P = unknown, R = unknown> {
  // Identity
  id: string;
  description: string;

  // Schemas for parameters and result
  schemas: {
    parameters: JsonSchema;
    result?: JsonSchema;
  };

  // UI rendering
  ui: ToolUI;

  // Behavior metadata
  behavior: ToolBehavior;

  // Permission requirements
  permissions: ToolPermissions;

  // Execute the tool
  execute(params: P, ctx: ToolContext): Promise<ToolExecutionResult<R>>;

  // Optional: Validate input before execution
  validateInput?(params: unknown): ValidationResult;

  // Optional: Check permissions before execution
  checkPermissions?(
    params: P,
    ctx: ToolContext,
  ): Promise<PermissionCheckResult>;

  // Optional: Get file paths this tool operates on (for permission matching)
  getPath?(params: P): string | string[];

  // Optional: Check if this is a search/read command (for optimization)
  isSearchOrReadCommand?(): { isSearch: boolean; isRead: boolean };
}

// =============================================================================
// JsonSchema - JSON Schema for parameter validation
// =============================================================================

export interface JsonSchemaProperty {
  description?: string;
  type?: string;
  enum?: string[];
  items?: JsonSchemaProperty | JsonSchemaProperty[];
}

export interface JsonSchema {
  type: string;
  properties?: Record<string, JsonSchemaProperty>;
  required?: string[];
  items?: JsonSchemaProperty | JsonSchemaProperty[];
}

// =============================================================================
// ToolResult - Result returned by tool execution (legacy format)
// Kept for backwards compatibility with orchestrator
// =============================================================================

export interface ToolResult {
  title: string;
  output: string;
  metadata?: Record<string, unknown>;
  error?: string;
}

// =============================================================================
// Color palette for tool tags
// =============================================================================

export const TOOL_COLORS: Record<string, string> = {
  read: "cyan",
  write: "green",
  edit: "yellow",
  bash: "magenta",
  glob: "blue",
  grep: "blue",
  skill: "white",
  agent: "red",
  question: "gray",
  webfetch: "cyan",
  websearch: "blue",
  todowrite: "green",
  lsp: "magenta",
};
