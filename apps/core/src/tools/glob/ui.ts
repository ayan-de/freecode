// =============================================================================
// Glob Tool UI - UI rendering for the Glob tool
// =============================================================================

import type { ToolUI } from "../tool.types.js";

// =============================================================================
// Color codes for terminal output
// =============================================================================

const COLORS = {
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  dim: "\x1b[2m",
  reset: "\x1b[0m",
};

// =============================================================================
// GlobToolUI - UI rendering for the Glob tool
// =============================================================================

export const globToolUI: Partial<ToolUI> = {
  renderToolUseMessage(toolId, args) {
    const pattern = args.pattern as string;

    return {
      type: "tool_use",
      toolId,
      args,
      status: "pending",
    };
  },

  renderToolResultMessage(toolId, result) {
    const isError = !!result.error;
    const status = isError ? "error" : "success";

    return {
      type: "tool_result",
      toolId,
      result,
      status,
    };
  },

  renderToolUseTag(toolId, args) {
    const pattern = args?.pattern as string;
    return { label: "glob", color: "blue" };
  },

  renderToolUseErrorMessage(toolId, error) {
    let friendlyError = error;
    if (error.includes("ENOENT")) {
      friendlyError = "Directory not found";
    }
    return {
      type: "tool_error",
      toolId,
      error: friendlyError,
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
