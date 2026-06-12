// =============================================================================
// SubagentStart Hooks - Run when a sub-agent is spawned
// =============================================================================

import type { HookContext } from "./types.js";
import { getHooksForEvent } from "./registry.js";
import { executeHooks } from "./executors/index.js";

// =============================================================================
// Run SubagentStart hooks when sub-agent is spawned
// =============================================================================

export async function runSubagentStartHooks(
  name: string,
  ctx: HookContext,
): Promise<{
  additionalContext?: string;
}> {
  const hooks = getHooksForEvent("SubagentStart");

  if (hooks.length === 0) {
    return {};
  }

  const input = {
    toolName: "SubagentStart",
    toolInput: { name },
  };

  const result = await executeHooks(hooks, input, ctx);

  return {
    additionalContext: result.additionalContexts.join("\n") || undefined,
  };
}
