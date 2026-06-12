// =============================================================================
// UserPromptSubmit Hooks - Run before user prompt goes to model
// =============================================================================

import type { HookContext } from "./types.js";
import { getHooksForEvent } from "./registry.js";
import { executeHooks } from "./executors/index.js";

export interface UserPromptSubmitResult {
  modifiedPrompt?: string;
  additionalContext?: string;
  blocked?: boolean;
  blockReason?: string;
}

// =============================================================================
// Run UserPromptSubmit hooks before user prompt goes to model
// =============================================================================

export async function runUserPromptSubmitHooks(
  prompt: string,
  context: HookContext,
): Promise<UserPromptSubmitResult> {
  const hooks = getHooksForEvent("UserPromptSubmit");

  if (hooks.length === 0) {
    return {};
  }

  const input = {
    toolName: "UserPromptSubmit",
    toolInput: { promptLength: prompt.length },
  };

  const result = await executeHooks(hooks, input, context);

  if (result.blocked) {
    return {
      blocked: true,
      blockReason: result.blockReason,
    };
  }

  return {
    modifiedPrompt: result.modifiedOutput as string | undefined,
    additionalContext: result.additionalContexts.join("\n") || undefined,
  };
}
