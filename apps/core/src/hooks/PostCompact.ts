// =============================================================================
// PostCompact Hooks - Run after memory compaction
// =============================================================================

import type { HookContext } from "./types.js"
import { getHooksForEvent } from "./registry.js"
import { executeHooks } from "./executors/index.js"

// =============================================================================
// Run PostCompact hooks after memory compaction
// =============================================================================

export async function runPostCompactHooks(
  context: HookContext,
  success: boolean
): Promise<{
  additionalContext?: string
}> {
  const hooks = getHooksForEvent("PostCompact")

  if (hooks.length === 0) {
    return {}
  }

  const input = {
    toolName: "PostCompact",
    toolInput: { success },
  }

  const result = await executeHooks(hooks, input, context)

  return {
    additionalContext: result.additionalContexts.join("\n") || undefined,
  }
}
