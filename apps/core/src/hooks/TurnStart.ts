// =============================================================================
// TurnStart Hooks - Run before each agent turn begins
// =============================================================================

import type { HookContext } from "./types.js";
import { getHooksForEvent } from "./registry.js";
import { executeHooks } from "./executors/index.js";

// =============================================================================
// Run TurnStart hooks before a turn executes
// =============================================================================

export async function runTurnStartHooks(ctx: HookContext): Promise<{
  additionalContext?: string;
}> {
  const hooks = getHooksForEvent("TurnStart");

  if (hooks.length === 0) {
    return {};
  }

  const input = {
    toolName: "TurnStart",
    toolInput: { turnCount: ctx.turnCount },
  };

  const result = await executeHooks(hooks, input, ctx);

  return {
    additionalContext: result.additionalContexts.join("\n") || undefined,
  };
}
