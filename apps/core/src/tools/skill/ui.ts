// =============================================================================
// Skill Tool UI - UI rendering for the Skill tool
// =============================================================================

import type { ToolUI } from "../tool.types.js";

// =============================================================================
// Color codes for terminal output
// =============================================================================

const COLORS = {
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  white: "\x1b[37m",
  dim: "\x1b[2m",
  reset: "\x1b[0m",
};

// =============================================================================
// SkillToolUI - UI rendering for the Skill tool
// =============================================================================

export const skillToolUI: Partial<ToolUI> = {
  renderToolUseMessage(toolId, args) {
    const skillName = args.skill as string;

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
    const skillName = args?.skill as string;
    return { label: skillName || "skill", color: "white" };
  },

  renderToolUseErrorMessage(toolId, error) {
    let friendlyError = error;
    if (error.includes("not found") || error.includes("ENOENT")) {
      friendlyError = "Skill not found";
    } else if (error.includes("parse")) {
      friendlyError = "Invalid skill format";
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
