// =============================================================================
// PostToolUse Hooks - Run after tool execution
// =============================================================================

import type { ToolCall, ToolResult } from "../agent/types.js";
import type { ToolCallInput, HookContext } from "./types.js";
import { MAX_HOOK_PAYLOAD_CHARS } from "./types.js";
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
  const input = createPostToolUseInput(toolCall, result, context);

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
// PostToolUse hook input
// =============================================================================

export function createPostToolUseInput(
  toolCall: ToolCall,
  result: ToolResult,
  _context: HookContext,
): ToolCallInput {
  // Capped so the command executor can hand it to a shell hook as an env var
  // without risking the platform's per-variable limit.
  const stdout = result.stdout ?? result.modelOutput ?? "";
  return {
    toolName: toolCall.tool,
    toolInput: toolCall.args as Record<string, unknown>,
    result:
      stdout.length > MAX_HOOK_PAYLOAD_CHARS
        ? `${stdout.slice(0, MAX_HOOK_PAYLOAD_CHARS)}\n[output truncated]`
        : stdout,
  };
}
