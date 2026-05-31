// =============================================================================
// Edit Tool UI - UI rendering for the Edit tool
// =============================================================================

import type { ToolUI } from "../tool.types"

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
}

// =============================================================================
// EditToolUI - UI rendering for the Edit tool
// =============================================================================

export const editToolUI: Partial<ToolUI> = {
  renderToolUseMessage(toolId, args) {
    const filePath = args.filePath as string

    return {
      type: "tool_use",
      toolId,
      args,
      status: "pending",
    }
  },

  renderToolResultMessage(toolId, result) {
    const isError = !!result.error
    const status = isError ? "error" : "success"

    return {
      type: "tool_result",
      toolId,
      result,
      status,
    }
  },

  renderToolUseTag(toolId, args) {
    const filePath = args?.filePath as string
    const basename = filePath?.split("/").pop() || "edit"
    return { label: basename, color: "yellow" }
  },

  renderToolUseProgressMessage(toolId, message, percent) {
    return {
      type: "tool_progress",
      toolId,
      message,
      percent,
    }
  },

  renderToolUseErrorMessage(toolId, error) {
    let friendlyError = error
    if (error.includes("ENOENT")) {
      friendlyError = "File not found"
    } else if (error.includes("match") || error.includes("pattern")) {
      friendlyError = "Pattern not found in file"
    } else if (error.includes("permission")) {
      friendlyError = "Permission denied"
    }
    return {
      type: "tool_error",
      toolId,
      error: friendlyError,
    }
  },

  renderToolUseRejectedMessage(toolId, reason) {
    return {
      type: "tool_rejected",
      toolId,
      reason,
    }
  },
}
