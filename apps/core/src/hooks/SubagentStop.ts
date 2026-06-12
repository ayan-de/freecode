// =============================================================================
// SubagentStop Hooks - Run when a sub-agent completes
// =============================================================================

import type { HookContext } from "./types.js";
import { getHooksForEvent } from "./registry.js";
import { executeHooks } from "./executors/index.js";

// =============================================================================
// Run SubagentStop hooks when sub-agent completes
// =============================================================================

export async function runSubagentStopHooks(
  name: string,
  ctx: HookContext,
): Promise<{
  additionalContext?: string;
}> {
  const hooks = getHooksForEvent("SubagentStop");

  if (hooks.length === 0) {
    return {};
  }

  const input = {
    toolName: "SubagentStop",
    toolInput: { name },
  };

  const result = await executeHooks(hooks, input, ctx);

  return {
    additionalContext: result.additionalContexts.join("\n") || undefined,
  };
}
