// =============================================================================
// PostToolUseFailure Hooks - Run after tool execution fails
// =============================================================================

import type { ToolCall, ToolResult } from "../agent/types.js";
import type { ToolCallInput, HookContext } from "./types.js";
import { getHooksForEvent } from "./registry.js";
import { executeHooks } from "./executors/index.js";

// =============================================================================
// Run PostToolUseFailure hooks after tool execution fails
// =============================================================================

export async function runPostToolUseFailureHooks(
  toolCall: ToolCall,
  error: string,
  context: HookContext,
): Promise<{
  additionalContext?: string;
  shouldRetry?: boolean;
  recoveryAction?: "retry" | "skip" | "abort";
}> {
  const hooks = getHooksForEvent("PostToolUseFailure");

  if (hooks.length === 0) {
    return {};
  }

  const input: ToolCallInput = {
    toolName: toolCall.tool,
    toolInput: toolCall.args as Record<string, unknown>,
  };

  const result = await executeHooks(hooks, input, context);

  return {
    additionalContext: result.additionalContexts.join("\n") || undefined,
  };
}
