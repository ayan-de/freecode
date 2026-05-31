// =============================================================================
// Callback Executor - Execute internal callback hooks
// =============================================================================

import type {
  HookContext,
  HookExecutionResult,
  ToolCallInput,
  HookResult,
} from "../types.js"

export async function executeCallbackHook(
  callback: (
    input: ToolCallInput,
    context: HookContext
  ) => Promise<HookResult>,
  input: ToolCallInput,
  context: HookContext,
  timeout?: number
): Promise<HookExecutionResult> {
  const timeoutId = timeout
    ? setTimeout(() => {
        resolve({
          success: false,
          blocked: false,
          error: `Hook timed out after ${timeout}ms`,
        })
      }, timeout)
    : null

  let resolved = false
  const resolve = (result: HookExecutionResult) => {
    if (!resolved) {
      resolved = true
      if (timeoutId) clearTimeout(timeoutId)
    }
    return result
  }

  try {
    const result = await callback(input, context)

    if (result.action === "block") {
      return resolve({
        success: false,
        blocked: true,
        blockReason: result.reason,
      })
    }

    if (result.action === "modify") {
      return resolve({
        success: true,
        blocked: undefined as never,
        modifiedInput: result.modifiedInput,
        modifiedOutput: result.modifiedOutput,
      })
    }

    return resolve({
      success: true,
      blocked: undefined as never,
    })
  } catch (err) {
    return resolve({
      success: false,
      blocked: false,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}
