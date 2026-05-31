// =============================================================================
// Bash Tool UI - UI rendering for the Bash tool
// =============================================================================

import type { ToolUI } from "../tool.types"

// =============================================================================
// Color codes for terminal output
// =============================================================================

const COLORS = {
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  magenta: "\x1b[35m",
  red: "\x1b[31m",
  dim: "\x1b[2m",
  reset: "\x1b[0m",
}

// =============================================================================
// BashToolUI - UI rendering for the Bash tool
// =============================================================================

export const bashToolUI: Partial<ToolUI> = {
  renderToolUseMessage(toolId, args) {
    const command = args.command as string
    // Truncate long commands for display
    const display = command.length > 60 ? command.slice(0, 57) + "..." : command

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
    const command = args?.command as string
    // Show first word of command as tag
    const cmd = command?.split(" ")[0] || "bash"
    return { label: cmd, color: "magenta" }
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
    if (error.includes("ENOENT") || error.includes("not found")) {
      friendlyError = "Command not found"
    } else if (error.includes("permission")) {
      friendlyError = "Permission denied"
    } else if (error.includes("timeout")) {
      friendlyError = "Command timed out"
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
