// =============================================================================
// PermissionRequest Hooks - Run before permission-gated operations
// =============================================================================

import type { ToolCall } from "../agent/types.js";
import type { ToolCallInput, HookContext } from "./types.js";
import { getMatchingHooks } from "./registry.js";
import { executeHooks } from "./executors/index.js";
import { bus } from "../bus/index.js";

export type PermissionDecision = "allow" | "deny" | "ask";

export interface PermissionRequestResult {
  decision: PermissionDecision;
  modifiedInput?: Record<string, unknown>;
  reason?: string;
}

// =============================================================================
// Run PermissionRequest hooks
// =============================================================================

export async function runPermissionRequestHooks(
  toolCall: ToolCall,
  context: HookContext,
): Promise<PermissionRequestResult> {
  const input: ToolCallInput = {
    toolName: toolCall.tool,
    toolInput: toolCall.args as Record<string, unknown>,
  };

  const matchingHooks = getMatchingHooks("PermissionRequest", input, context);

  if (matchingHooks.length === 0) {
    return { decision: "ask" }; // Default: ask user
  }

  const result = await executeHooks(matchingHooks, input, context);

  if (result.blocked) {
    bus.publish({
      type: "hook.blocked",
      hookName: "PermissionRequest",
      event: "PermissionRequest",
      sessionId: context.sessionId,
      reason: result.blockReason,
    } as any);

    return {
      decision: "deny",
      reason: result.blockReason,
    };
  }

  return {
    decision: "allow",
    modifiedInput: result.modifiedInput,
    reason: result.additionalContexts.join("\n") || undefined,
  };
}
