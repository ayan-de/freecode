// =============================================================================
// PreToolUse Hooks - Run before tool execution
// =============================================================================

import type { ToolCall } from "../agent/types.js"
import type { ToolCallInput, HookContext } from "./types.js"
import { getMatchingHooks } from "./registry.js"
import { executeHooks, type AggregatedHookResult } from "./executors/index.js"
import { bus } from "../bus/index.js"

// =============================================================================
// Run PreToolUse hooks for a tool call
// =============================================================================

export async function runPreToolUseHooks(
  toolCall: ToolCall,
  context: HookContext
): Promise<{
  allowed: boolean
  modifiedInput?: Record<string, unknown>
  additionalContext?: string
  blockReason?: string
}> {
  const input: ToolCallInput = {
    toolName: toolCall.tool,
    toolInput: toolCall.args as Record<string, unknown>,
  }

  const matchingHooks = getMatchingHooks("PreToolUse", input, context)

  if (matchingHooks.length === 0) {
    return { allowed: true }
  }

  const result = await executeHooks(matchingHooks, input, context)

  if (result.blocked) {
    bus.publish({
      type: "hook.blocked",
      hookName: "PreToolUse",
      event: "PreToolUse",
      sessionId: context.sessionId,
      reason: result.blockReason,
    } as any)

    return {
      allowed: false,
      blockReason: result.blockReason,
    }
  }

  return {
    allowed: true,
    modifiedInput: result.modifiedInput,
    additionalContext: result.additionalContexts.join("\n") || undefined,
  }
}

// =============================================================================
// PreToolUse hook input for external callers
// =============================================================================

export function createPreToolUseInput(
  toolCall: ToolCall,
  context: HookContext
): ToolCallInput {
  return {
    toolName: toolCall.tool,
    toolInput: toolCall.args as Record<string, unknown>,
  }
}
