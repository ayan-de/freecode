// =============================================================================
// Write Tool UI - UI rendering for the Write tool
// =============================================================================

import type { ToolUI } from "../tool.types.js";

// =============================================================================
// Color codes for terminal output
// =============================================================================

const COLORS = {
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  dim: "\x1b[2m",
  reset: "\x1b[0m",
};

// =============================================================================
// WriteToolUI - UI rendering for the Write tool
// =============================================================================

export const writeToolUI: Partial<ToolUI> = {
  renderToolUseMessage(toolId, args) {
    const filePath = args.filePath as string;
    const content = args.content as string;
    const lines = content?.split("\n").length || 0;

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
    const content = args?.content as string;
    const lines = content?.split("\n").length || 0;
    return { label: `write(${lines}L)`, color: "green" };
  },

  renderToolUseErrorMessage(toolId, error) {
    let friendlyError = error;
    if (error.includes("ENOENT")) {
      friendlyError = "Directory does not exist";
    } else if (error.includes("permission")) {
      friendlyError = "Permission denied";
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
