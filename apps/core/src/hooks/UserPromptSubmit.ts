// =============================================================================
// UserPromptSubmit Hooks - Run before user prompt goes to model
// =============================================================================

import type { HookContext } from "./types.js";
import { MAX_HOOK_PAYLOAD_CHARS } from "./types.js";
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

  // The prompt itself, not just its length — a hook whose purpose is to
  // rewrite or veto a prompt has to be able to read it. Capped so the JSON
  // fits in `$CLAUDE_TOOL_INPUT` within every platform's per-env-var limit;
  // `promptLength` always carries the real length, so a hook can detect the
  // truncation.
  const input = {
    toolName: "UserPromptSubmit",
    toolInput: {
      prompt:
        prompt.length > MAX_HOOK_PAYLOAD_CHARS
          ? `${prompt.slice(0, MAX_HOOK_PAYLOAD_CHARS)}\n[prompt truncated]`
          : prompt,
      promptLength: prompt.length,
    },
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
