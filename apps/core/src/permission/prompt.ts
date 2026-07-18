// =============================================================================
// Permission Prompt - Interactive approval round-trip for "ask" decisions
// Publishes permission.asked on the bus, applies the user's answer (session
// grant or persisted rule), and reports allow/deny back to the agent loop.
// Headless or timed-out asks resolve to deny — never silent allow.
// Spec: docs/superpowers/specs/2026-07-18-permission-rules.md §6
// =============================================================================

import { randomUUID } from "crypto";
import { askPermission } from "../bus/index.js";
import { extractTarget } from "./rules.js";
import { suggestRule } from "./suggest.js";
import type { PermissionSettingsManager } from "./settings.js";

export interface PermissionPromptOutcome {
  allowed: boolean;
  reason?: string;
}

export async function promptForPermission(opts: {
  toolName: string;
  args: Record<string, unknown>;
  projectRoot: string;
  settings: PermissionSettingsManager;
  sessionId?: string;
  /** Which rule or mode default triggered the ask */
  reason?: string;
}): Promise<PermissionPromptOutcome> {
  const { toolName, args, projectRoot, settings, sessionId, reason } = opts;
  const suggestedRule = suggestRule(toolName, args, projectRoot);
  const description = extractTarget(toolName, args) ?? toolName;

  let answer;
  try {
    answer = await askPermission(randomUUID(), {
      sessionId,
      toolName,
      args,
      description,
      suggestedRule,
      reason,
    });
  } catch (error) {
    // Rejected, headless, or timed out — deny with a continue-without hint
    const message = error instanceof Error ? error.message : "unknown error";
    return {
      allowed: false,
      reason: `Permission not granted (${message}). You can continue without this action or try a different approach.`,
    };
  }

  if (answer.decision === "deny") {
    return {
      allowed: false,
      reason:
        "User denied permission. You can continue without this action or try a different approach.",
    };
  }

  const rule = answer.editedRule ?? suggestedRule;
  if (answer.decision === "allow-session") {
    settings.addSessionGrant(rule);
  } else if (answer.decision === "allow-project") {
    settings.appendRule("project", "allow", rule);
  } else if (answer.decision === "allow-always") {
    settings.appendRule("user", "allow", rule);
  }
  return { allowed: true };
}
