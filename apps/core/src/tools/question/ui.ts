// =============================================================================
// Question Tool UI - UI rendering for the Question tool
// =============================================================================

import type { ToolUI } from "../tool.types";

// =============================================================================
// Color codes for terminal output
// =============================================================================

const COLORS = {
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  gray: "\x1b[90m",
  dim: "\x1b[2m",
  reset: "\x1b[0m",
};

// =============================================================================
// QuestionToolUI - UI rendering for the Question tool
// =============================================================================

export const questionToolUI: Partial<ToolUI> = {
  renderToolUseMessage(toolId, args) {
    const questions = args.questions as Array<{ question: string }>;

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
    const questions = args?.questions as Array<{ question: string }>;
    const count = questions?.length || 1;
    return { label: `ask(${count})`, color: "gray" };
  },

  renderToolUseErrorMessage(toolId, error) {
    let friendlyError = error;
    if (error.includes("timeout")) {
      friendlyError = "Question timed out";
    } else if (error.includes("cancel")) {
      friendlyError = "Question cancelled";
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
