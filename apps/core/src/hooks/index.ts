// =============================================================================
// Hooks Module - Public API
// =============================================================================

export {
  // Runtime
  createHookRuntime,
  getHookRuntime,
  resetHookRuntime,
  type HookRuntime,

  // Types
  HOOK_EVENT_NAMES,
  type HookEventName,
  type ToolCallInput,
  type HookContext,
  type HookCommand,
  type HookMatcher,
  type RegisteredHook,
  type HookExecutionResult,
  type CommandHook,
  type PromptHook,
  type CallbackHook,
  type HookResult,

  // Registry
  registerHook,
  unregisterHook,
  unregisterAllHooks,
  getMatchingHooks,
  getHooksForEvent,
  listRegisteredHooks,

  // Individual hook handlers
  runPreToolUseHooks,
  runPostToolUseHooks,
  runPermissionRequestHooks,
  runPreCompactHooks,
  runPostCompactHooks,
  runSessionStartHooks,
  runUserPromptSubmitHooks,
  runSubagentStartHooks,
  runSubagentStopHooks,
  runStopHooks,
  runTurnStartHooks,
  runTurnEndHooks,
  runNotificationHooks,
  type TurnUsage,
} from "./runtime.js";

export { executeCommandHook } from "./executors/command.js";
export { executeCallbackHook } from "./executors/callback.js";
