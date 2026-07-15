// =============================================================================
// TurnEnd Hooks - Run after each agent turn completes
// =============================================================================

import type { HookContext } from "./types.js";
import { getHooksForEvent } from "./registry.js";
import { executeHooks } from "./executors/index.js";

export interface TurnUsage {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadInputTokens?: number;
  cacheCreationInputTokens?: number;
}

// =============================================================================
// Run TurnEnd hooks after a turn completes (usage enables cost tracking)
// =============================================================================

export async function runTurnEndHooks(
  ctx: HookContext,
  usage?: TurnUsage,
): Promise<{
  additionalContext?: string;
}> {
  const hooks = getHooksForEvent("TurnEnd");

  if (hooks.length === 0) {
    return {};
  }

  const input = {
    toolName: "TurnEnd",
    toolInput: { turnCount: ctx.turnCount, ...(usage ?? {}) },
  };

  const result = await executeHooks(hooks, input, ctx);

  return {
    additionalContext: result.additionalContexts.join("\n") || undefined,
  };
}
