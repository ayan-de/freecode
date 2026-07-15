// =============================================================================
// Tool Factory - buildTool() factory for creating Tool instances
// PRIMARY: Provides sensible defaults for all tool properties
// Based on Claude Code's buildTool() pattern
// =============================================================================

import type {
  Tool,
  ToolUI,
  ToolBehavior,
  ToolPermissions,
  ToolExecutionResult,
  ValidationResult,
  PermissionCheckResult,
  JsonSchema,
  TOOL_COLORS,
} from "./tool.types.js";
import type { ToolContext } from "./types.js";

// =============================================================================
// Default ToolUI - Console/TUI based rendering
// Returns structured messages that TUI can render
// =============================================================================

export const defaultToolUI: ToolUI = {
  renderToolUseMessage(toolId, args) {
    return {
      type: "tool_use",
      toolId,
      args,
      status: "pending",
    };
  },

  renderToolResultMessage(toolId, result) {
    return {
      type: "tool_result",
      toolId,
      result,
      status: result.error ? "error" : "success",
    };
  },

  renderToolUseTag(toolId) {
    const colors: Record<string, string> = {
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
    return {
      label: toolId,
      color: colors[toolId] || "white",
    };
  },

  renderToolUseProgressMessage(toolId, message, percent) {
    return {
      type: "tool_progress",
      toolId,
      message,
      percent,
    };
  },

  renderToolUseErrorMessage(toolId, error) {
    return {
      type: "tool_error",
      toolId,
      error,
    };
  },

  renderToolUseRejectedMessage(toolId, reason) {
    return {
      type: "tool_rejected",
      toolId,
      reason,
    };
  },
};

// =============================================================================
// Default Behavior
// =============================================================================

export const defaultBehavior: ToolBehavior = {
  isConcurrencySafe: false,
  isDestructive: false,
  interruptBehavior: "await",
  maxResultSizeChars: 500_000,
  userFacingName: "",
};

// =============================================================================
// Default Permissions
// =============================================================================

export const defaultPermissions: ToolPermissions = {
  operations: [],
  requiresApproval: false,
};

// =============================================================================
// buildTool() - Factory for creating Tool instances with sensible defaults
// =============================================================================

export function buildTool<P, R>(config: {
  id: string;
  description: string;
  schemas: { parameters: JsonSchema; result?: JsonSchema };
  permissions?: Partial<ToolPermissions>;
  behavior?: Partial<ToolBehavior>;
  ui?: Partial<ToolUI>;
  execute: (params: P, ctx: ToolContext) => Promise<ToolExecutionResult<R>>;
  validateInput?: (params: unknown) => ValidationResult;
  checkPermissions?: (
    params: P,
    ctx: ToolContext,
  ) => Promise<PermissionCheckResult>;
  getPath?: (params: P) => string | string[];
  isSearchOrReadCommand?: () => { isSearch: boolean; isRead: boolean };
}): Tool<P, R> {
  const fullPermissions: ToolPermissions = {
    ...defaultPermissions,
    ...config.permissions,
  };

  const fullBehavior: ToolBehavior = {
    ...defaultBehavior,
    ...config.behavior,
    userFacingName: config.behavior?.userFacingName || config.id,
  };

  const fullUI: ToolUI = {
    ...defaultToolUI,
    ...config.ui,
  };

  return {
    id: config.id,
    description: config.description,
    schemas: config.schemas as Tool<P, R>["schemas"],
    ui: fullUI,
    behavior: fullBehavior,
    permissions: fullPermissions,
    execute: config.execute as Tool<P, R>["execute"],
    validateInput: config.validateInput,
    checkPermissions: config.checkPermissions as Tool<P, R>["checkPermissions"],
    getPath: config.getPath as Tool<P, R>["getPath"],
    isSearchOrReadCommand: config.isSearchOrReadCommand,
  };
}

// =============================================================================
// executeTool() - Helper to execute a tool with standard error handling
// Returns the legacy ToolResult format for backwards compatibility
// =============================================================================

export async function executeTool<P, R>(
  tool: Tool<P, R>,
  params: P,
  ctx: ToolContext,
): Promise<{
  title: string;
  output: string;
  metadata?: Record<string, unknown>;
}> {
  try {
    const result = await tool.execute(params, ctx);

    if (!result.success) {
      return {
        title: tool.id,
        output: result.error,
        metadata: { success: false, toolId: tool.id },
      };
    }

    // Handle different result types
    if (typeof result.result === "string") {
      return {
        title: tool.id,
        output: result.result,
        metadata: { success: true, toolId: tool.id },
      };
    }

    // For complex results, serialize to string
    return {
      title: tool.id,
      output: JSON.stringify(result.result, null, 2),
      metadata: { success: true, toolId: tool.id, data: result.result },
    };
  } catch (error) {
    return {
      title: tool.id,
      output: error instanceof Error ? error.message : String(error),
      metadata: { success: false, toolId: tool.id, error: String(error) },
    };
  }
}
