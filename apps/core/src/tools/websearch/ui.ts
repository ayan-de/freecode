// =============================================================================
// WebSearch Tool UI
// =============================================================================

import type { ToolUI } from "../tool.types.js";

export const websearchToolUI: Partial<ToolUI> = {
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
    const query = (args?.query as string) ?? "";
    return { label: query ? `"${query}"` : "websearch", color: "blue" };
  },

  renderToolUseErrorMessage(toolId, error) {
    return { type: "tool_error", toolId, error };
  },

  renderToolUseRejectedMessage(toolId, reason) {
    return { type: "tool_rejected", toolId, reason };
  },
};
