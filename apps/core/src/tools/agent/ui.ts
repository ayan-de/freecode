// =============================================================================
// Agent Tool UI - UI rendering for the Agent tool
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
// AgentToolUI - UI rendering for the Agent tool
// =============================================================================

export const agentToolUI: Partial<ToolUI> = {
  renderToolUseMessage(toolId, args) {
    const description = args.description as string;
    const prompt = args.prompt as string;

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
    const description = args?.description as string;
    return { label: description?.slice(0, 15) || "agent", color: "red" };
  },

  renderToolUseProgressMessage(toolId, message, percent) {
    return {
      type: "tool_progress",
      toolId,
      message,
      percent,
    };
  },

  renderToolUseErrorMessage(toolId, error) {
    let friendlyError = error;
    if (error.includes("loop")) {
      friendlyError = "Agent loop detected";
    } else if (error.includes("timeout")) {
      friendlyError = "Agent timed out";
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
