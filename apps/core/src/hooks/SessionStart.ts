// =============================================================================
// SessionStart Hooks - Run when session begins
// =============================================================================

import type { HookContext } from "./types.js"
import { getHooksForEvent } from "./registry.js"
import { executeHooks } from "./executors/index.js"
import { bus } from "../bus/index.js"

export interface SessionStartResult {
  additionalContext?: string
  initialUserMessage?: string
  watchPaths?: string[]
}

// =============================================================================
// Run SessionStart hooks
// =============================================================================

export async function runSessionStartHooks(
  context: HookContext
): Promise<SessionStartResult> {
  const hooks = getHooksForEvent("SessionStart")

  if (hooks.length === 0) {
    return {}
  }

  // SessionStart hooks don't have tool-specific input
  const input = {
    toolName: "SessionStart",
    toolInput: { sessionId: context.sessionId },
  }

  const result = await executeHooks(hooks, input, context)

  return {
    additionalContext: result.additionalContexts.join("\n") || undefined,
    initialUserMessage: result.modifiedOutput as string | undefined,
  }
}
