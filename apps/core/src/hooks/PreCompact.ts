// =============================================================================
// PreCompact Hooks - Run before memory compaction
// =============================================================================

import type { HookContext } from "./types.js"
import { getHooksForEvent } from "./registry.js"
import { executeHooks } from "./executors/index.js"

// =============================================================================
// Run PreCompact hooks before memory compaction
// =============================================================================

export async function runPreCompactHooks(
  context: HookContext
): Promise<{
  allowed: boolean
  blockReason?: string
}> {
  const hooks = getHooksForEvent("PreCompact")

  if (hooks.length === 0) {
    return { allowed: true }
  }

  const input = {
    toolName: "PreCompact",
    toolInput: { historyLength: context.turnCount },
  }

  const result = await executeHooks(hooks, input, context)

  if (result.blocked) {
    return {
      allowed: false,
      blockReason: result.blockReason,
    }
  }

  return {
    allowed: true,
  }
}
