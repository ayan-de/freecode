// =============================================================================
// Tool Renderer - Transforms ToolUseMessages to TUI output
// PRIMARY: Bridge between tool UI output and actual TUI rendering
// This module is consumed by the TUI layer to render tool messages
// =============================================================================

import type { ToolUseMessage, TOOL_COLORS } from "./tool.types"

// =============================================================================
// ToolRenderer - Interface for rendering tool messages
// =============================================================================

export interface ToolRenderer {
  render(message: ToolUseMessage): string
  renderBatch(messages: ToolUseMessage[]): string
}

// =============================================================================
// Emoji mappings for tool message types
// =============================================================================

const MESSAGE_EMOJI: Record<ToolUseMessage["type"], string> = {
  tool_use: "🔧",
  tool_result: "✅",
  tool_progress: "⏳",
  tool_error: "❌",
  tool_rejected: "🚫",
}

// =============================================================================
// Color codes for terminal output
// =============================================================================

const COLORS = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  magenta: "\x1b[35m",
  blue: "\x1b[34m",
  red: "\x1b[31m",
  white: "\x1b[37m",
  gray: "\x1b[90m",
}

// =============================================================================
// createToolRenderer - Factory for creating a tool renderer
// =============================================================================

export function createToolRenderer(): ToolRenderer {
  // Cache for color functions
  const colorize = (text: string, color: string): string => {
    const colorCode = COLORS[color as keyof typeof COLORS] || COLORS.white
    return `${colorCode}${text}${COLORS.reset}`
  }

  // Format args for display
  const formatArgs = (args: Record<string, unknown>): string => {
    const entries = Object.entries(args)
    if (entries.length === 0) return ""
    if (entries.length === 1) {
      const [, value] = entries[0]
      return String(value)
    }
    const summary = entries
      .slice(0, 3)
      .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
      .join(", ")
    return entries.length > 3 ? `${summary}...` : summary
  }

  // Truncate output for display
  const truncate = (text: string, maxLen: number): string => {
    if (text.length <= maxLen) return text
    return text.slice(0, maxLen - 3) + "..."
  }

  return {
    render(message: ToolUseMessage): string {
      switch (message.type) {
        case "tool_use": {
          const argsStr = formatArgs(message.args)
          const status = message.status === "running" ? " (running...)" : ""
          return `${MESSAGE_EMOJI.tool_use} ${colorize(message.toolId, "cyan")}${argsStr ? `(${argsStr})` : ""}${colorize(status, "dim")}`
        }

        case "tool_result": {
          const status = message.status === "error" ? colorize(" [ERROR]", "red") : ""
          const output = truncate(message.result.output || "(no output)", 500)
          return `${MESSAGE_EMOJI.tool_result} ${colorize(message.toolId, "cyan")}: ${output}${status}`
        }

        case "tool_progress": {
          const percent = message.percent !== undefined ? ` ${message.percent}%` : ""
          return `${MESSAGE_EMOJI.tool_progress} ${colorize(message.toolId, "cyan")}: ${message.message}${colorize(percent, "dim")}`
        }

        case "tool_error": {
          return `${MESSAGE_EMOJI.tool_error} ${colorize(message.toolId, "cyan")}: ${colorize(message.error, "red")}`
        }

        case "tool_rejected": {
          return `${MESSAGE_EMOJI.tool_rejected} ${colorize(message.toolId, "cyan")}: ${colorize(message.reason, "yellow")}`
        }
      }
    },

    renderBatch(messages: ToolUseMessage[]): string {
      return messages.map((m) => this.render(m)).join("\n")
    },
  }
}

// =============================================================================
// formatToolUseMessage - Standalone function to format a single message
// =============================================================================

export function formatToolUseMessage(message: ToolUseMessage): string {
  const renderer = createToolRenderer()
  return renderer.render(message)
}

// =============================================================================
// formatToolUseTag - Format a tool use tag
// =============================================================================

export function formatToolUseTag(
  label: string,
  color: string = "white"
): string {
  const COLORS = {
    cyan: "\x1b[36m",
    green: "\x1b[32m",
    yellow: "\x1b[33m",
    magenta: "\x1b[35m",
    blue: "\x1b[34m",
    red: "\x1b[31m",
    white: "\x1b[37m",
    gray: "\x1b[90m",
  }
  const colorCode = COLORS[color as keyof typeof COLORS] || COLORS.white
  return `${colorCode}[${label}]`
}
