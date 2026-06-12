// =============================================================================
// Executor Index - Coordinates hook execution
// =============================================================================

import type { ToolCallInput, HookExecutionResult } from "../types.js";
import type { HookContext, HookCommand, RegisteredHook } from "../types.js";
import { executeCommandHook } from "./command.js";
import { executeCallbackHook } from "./callback.js";
import { bus } from "../../bus/index.js";

export { executeCommandHook } from "./command.js";
export { executeCallbackHook } from "./callback.js";

// =============================================================================
// Execute a single hook
// =============================================================================

export async function executeHook(
  hook: RegisteredHook,
  input: ToolCallInput,
  context: HookContext,
): Promise<HookExecutionResult> {
  // Emit hook triggered event
  bus.publish({
    type: "hook.triggered",
    hookName: hook.name,
    event: hook.event,
    sessionId: context.sessionId,
  } as any);

  try {
    const result = await executeHookCommand(hook.command, input, context);

    if (!result.success && result.blocked) {
      bus.publish({
        type: "hook.blocked",
        hookName: hook.name,
        event: hook.event,
        sessionId: context.sessionId,
        reason: result.blockReason || "Unknown reason",
      } as any);
    }

    return result;
  } catch (err) {
    return {
      success: false,
      blocked: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// =============================================================================
// Execute a hook command based on its type
// =============================================================================

async function executeHookCommand(
  matcher: HookCommand,
  input: ToolCallInput,
  context: HookContext,
): Promise<HookExecutionResult> {
  switch (matcher.type) {
    case "command":
      return executeCommandHook(matcher.command, input, context, {
        shell: matcher.shell,
        timeout: matcher.timeout ? matcher.timeout * 1000 : undefined,
      });

    case "callback":
      return executeCallbackHook(
        matcher.callback,
        input,
        context,
        matcher.timeout ? matcher.timeout * 1000 : undefined,
      );

    case "prompt":
      // For now, prompt hooks are not implemented
      // They would require LLM evaluation
      return {
        success: true,
      };

    default:
      return {
        success: false,
        blocked: true,
      };
  }
}

// =============================================================================
// Execute multiple hooks and aggregate results
// =============================================================================

export interface AggregatedHookResult {
  blocked: boolean;
  blockReason?: string;
  modifiedInput?: Record<string, unknown>;
  modifiedOutput?: unknown;
  additionalContexts: string[];
  error?: string;
}

export async function executeHooks(
  hooks: RegisteredHook[],
  input: ToolCallInput,
  context: HookContext,
): Promise<AggregatedHookResult> {
  const result: AggregatedHookResult = {
    blocked: false,
    additionalContexts: [],
  };

  for (const hook of hooks) {
    const hookResult = await executeHook(hook, input, context);

    if (!hookResult.success) {
      result.error = hookResult.error;
    }

    if (hookResult.blocked) {
      result.blocked = true;
      result.blockReason = hookResult.blockReason;
      break; // Stop on first block
    }

    if (hookResult.modifiedInput) {
      result.modifiedInput = hookResult.modifiedInput;
    }

    if (hookResult.modifiedOutput) {
      result.modifiedOutput = hookResult.modifiedOutput;
    }

    if (hookResult.additionalContext) {
      result.additionalContexts.push(hookResult.additionalContext);
    }
  }

  return result;
}
