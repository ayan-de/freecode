// =============================================================================
// WebFetch Tool UI
// =============================================================================

import type { ToolUI } from "../tool.types.js";

export const webfetchToolUI: Partial<ToolUI> = {
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
    const url = (args?.url as string) ?? "";
    let host = url;
    try {
      host = new URL(url).host;
    } catch {
      /* keep raw */
    }
    return { label: host || "webfetch", color: "cyan" };
  },

  renderToolUseErrorMessage(toolId, error) {
    return { type: "tool_error", toolId, error };
  },

  renderToolUseRejectedMessage(toolId, reason) {
    return { type: "tool_rejected", toolId, reason };
  },
};
