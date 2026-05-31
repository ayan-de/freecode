// =============================================================================
// Stop Hooks - Run when agent loop terminates
// =============================================================================

import type { HookContext } from "./types.js"
import { getHooksForEvent } from "./registry.js"
import { executeHooks } from "./executors/index.js"

export interface StopReason {
  reason: string
  blocked?: boolean
  blockReason?: string
}

// =============================================================================
// Run Stop hooks
// =============================================================================

export async function runStopHooks(
  reason: string,
  context: HookContext
): Promise<StopReason> {
  const hooks = getHooksForEvent("Stop")

  if (hooks.length === 0) {
    return { reason }
  }

  // Stop hooks don't have tool-specific input
  const input = {
    toolName: "Stop",
    toolInput: { reason },
  }

  const result = await executeHooks(hooks, input, context)

  if (result.blocked) {
    return {
      reason: result.blockReason || reason,
      blocked: true,
      blockReason: result.blockReason,
    }
  }

  return {
    reason: result.additionalContexts.join("\n") || reason,
  }
}
