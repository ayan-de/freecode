// =============================================================================
// PostToolUse Hooks - Run after tool execution
// =============================================================================

import type { ToolCall, ToolResult } from "../agent/types.js";
import type { ToolCallInput, HookContext } from "./types.js";
import { getMatchingHooks } from "./registry.js";
import { executeHooks } from "./executors/index.js";
import { bus } from "../bus/index.js";

// =============================================================================
// Run PostToolUse hooks after tool execution
// =============================================================================

export async function runPostToolUseHooks(
  toolCall: ToolCall,
  result: ToolResult,
  context: HookContext,
): Promise<{
  modifiedOutput?: unknown;
  additionalContext?: string;
}> {
  const input: ToolCallInput = {
    toolName: toolCall.tool,
    toolInput: toolCall.args as Record<string, unknown>,
  };

  const matchingHooks = getMatchingHooks("PostToolUse", input, context);

  if (matchingHooks.length === 0) {
    return {};
  }

  const hookResult = await executeHooks(matchingHooks, input, context);

  return {
    modifiedOutput: hookResult.modifiedOutput,
    additionalContext: hookResult.additionalContexts.join("\n") || undefined,
  };
}

// =============================================================================
// PostToolUse hook input for external callers
// =============================================================================

export function createPostToolUseInput(
  toolCall: ToolCall,
  result: ToolResult,
  context: HookContext,
): ToolCallInput & { result?: string } {
  return {
    toolName: toolCall.tool,
    toolInput: toolCall.args as Record<string, unknown>,
    result: result.stdout,
  };
}
