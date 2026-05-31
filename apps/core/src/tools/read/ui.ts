// =============================================================================
// Read Tool UI - UI rendering for the Read tool
// =============================================================================

import type { ToolUI, ToolUseMessage } from "../tool.types"
import type { ToolResult } from "../types"

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
// formatFilePath - Format a file path for display
// =============================================================================

function formatFilePath(filePath: string, color: string = "cyan"): string {
  const colorCode = COLORS[color as keyof typeof COLORS] || COLORS.cyan
  return `${colorCode}${filePath}${COLORS.reset}`
}

// =============================================================================
// formatLineRange - Format a line range for display
// =============================================================================

function formatLineRange(start: number, end: number, total: number): string {
  if (end >= total) {
    return `lines ${start}-${end} of ${total}`
  }
  return `lines ${start}-${end} of ${total} (truncated)`
}

// =============================================================================
// ReadToolUI - UI rendering for the Read tool
// =============================================================================

export const readToolUI: Partial<ToolUI> = {
  renderToolUseMessage(toolId, args) {
    const filePath = args.filePath as string
    const offset = args.offset as number | undefined
    const limit = args.limit as number | undefined

    let location = formatFilePath(filePath)
    if (offset !== undefined || limit !== undefined) {
      const rangeStr = offset !== undefined
        ? `:${offset}` + (limit !== undefined ? `:${limit}` : "")
        : ""
      location = `${formatFilePath(filePath)}${COLORS.dim}${rangeStr}${COLORS.reset}`
    }

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

    // Parse metadata if available
    const truncated = result.metadata?.truncated as boolean | undefined
    const lines = result.metadata?.lines as number | undefined

    let extraInfo = ""
    if (!isError && truncated) {
      extraInfo = ` ${COLORS.yellow}[truncated]${COLORS.reset}`
    }
    if (!isError && lines !== undefined) {
      extraInfo += ` ${COLORS.dim}(${lines} lines)${COLORS.reset}`
    }

    return {
      type: "tool_result",
      toolId,
      result,
      status,
    }
  },

  renderToolUseTag(toolId, args) {
    // Show file count or directory indicator
    if (args?.filePath) {
      return { label: "read", color: "cyan" }
    }
    return { label: "read", color: "cyan" }
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
    // Provide user-friendly error messages
    let friendlyError = error
    if (error.includes("ENOENT") || error.includes("not exist")) {
      friendlyError = "File not found"
    } else if (error.includes("EISDIR")) {
      friendlyError = "Is a directory (use Read for directories)"
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

// =============================================================================
// Helper function to render read tool output for TUI
// =============================================================================

export function renderReadOutput(
  filePath: string,
  content: string,
  options: {
    offset?: number
    limit?: number
    truncated?: boolean
    totalLines?: number
  } = {}
): string {
  const lines: string[] = []
  const contentLines = content.split("\n")

  // Header
  lines.push(`${COLORS.cyan}📄 ${filePath}${COLORS.reset}`)

  // Content with line numbers
  const startLine = options.offset || 1
  const displayLines = options.limit ? contentLines.slice(0, options.limit) : contentLines

  displayLines.forEach((line, i) => {
    const lineNum = startLine + i
    lines.push(`${COLORS.dim}${String(lineNum).padStart(4)}${COLORS.reset} ${line}`)
  })

  // Footer
  if (options.truncated) {
    lines.push(`${COLORS.yellow}⚠ Output truncated (use offset to continue)${COLORS.reset}`)
  } else if (options.totalLines !== undefined) {
    lines.push(`${COLORS.dim}(End of file - ${options.totalLines} lines)${COLORS.reset}`)
  }

  return lines.join("\n")
}
