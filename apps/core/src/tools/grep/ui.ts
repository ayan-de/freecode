// =============================================================================
// Grep Tool UI - UI rendering for the Grep tool
// =============================================================================

import type { ToolUI } from "../tool.types";

// =============================================================================
// Color codes for terminal output
// =============================================================================

const COLORS = {
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  red: "\x1b[31m",
  dim: "\x1b[2m",
  reset: "\x1b[0m",
};

// =============================================================================
// GrepToolUI - UI rendering for the Grep tool
// =============================================================================

export const grepToolUI: Partial<ToolUI> = {
  renderToolUseMessage(toolId, args) {
    const pattern = args.pattern as string;
    const filePath = args.filePath as string | undefined;

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
    return { label: "grep", color: "blue" };
  },

  renderToolUseErrorMessage(toolId, error) {
    let friendlyError = error;
    if (error.includes("ENOENT")) {
      friendlyError = "File not found";
    } else if (error.includes("pattern")) {
      friendlyError = "Invalid pattern";
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
