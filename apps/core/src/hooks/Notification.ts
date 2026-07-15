// =============================================================================
// Notification Hooks - Run when the agent needs user attention
// =============================================================================

import type { HookContext } from "./types.js";
import { getHooksForEvent } from "./registry.js";
import { executeHooks } from "./executors/index.js";

// =============================================================================
// Run Notification hooks (e.g. permission approval needed, agent idle)
// =============================================================================

export async function runNotificationHooks(
  message: string,
  ctx: HookContext,
): Promise<void> {
  const hooks = getHooksForEvent("Notification");

  if (hooks.length === 0) {
    return;
  }

  const input = {
    toolName: "Notification",
    toolInput: { message },
  };

  await executeHooks(hooks, input, ctx);
}
