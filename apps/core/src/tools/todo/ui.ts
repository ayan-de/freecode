// =============================================================================
// TodoWrite Tool UI
// =============================================================================

import type { ToolUI } from "../tool.types.js";

export const todoToolUI: Partial<ToolUI> = {
  renderToolUseMessage(toolId, args) {
    return { type: "tool_use", toolId, args, status: "pending" };
  },

  renderToolResultMessage(toolId, result) {
    return {
      type: "tool_result",
      toolId,
      result,
      status: result.error ? "error" : "success",
    };
  },

  renderToolUseTag(toolId, args) {
    const todos = Array.isArray(args?.todos) ? args.todos : [];
    return { label: `${todos.length} todos`, color: "green" };
  },

  renderToolUseErrorMessage(toolId, error) {
    return { type: "tool_error", toolId, error };
  },

  renderToolUseRejectedMessage(toolId, reason) {
    return { type: "tool_rejected", toolId, reason };
  },
};
