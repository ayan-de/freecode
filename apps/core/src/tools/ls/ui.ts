// =============================================================================
// Ls Tool UI - UI rendering for the Ls tool
// =============================================================================

import type { ToolUI } from "../tool.types.js";

// =============================================================================
// LsToolUI - UI rendering for the Ls tool
// =============================================================================

export const lsToolUI: Partial<ToolUI> = {
  renderToolUseMessage(toolId, args) {
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
    return { label: "ls", color: "cyan" };
  },

  renderToolUseErrorMessage(toolId, error) {
    let friendlyError = error;
    if (error.includes("ENOENT") || error.includes("not found")) {
      friendlyError = "Directory not found";
    }
    if (error.includes("Not a directory")) {
      friendlyError = "Not a directory";
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
