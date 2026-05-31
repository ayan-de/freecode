// =============================================================================
// Hook Types - Hook definitions for the FreeCode agent lifecycle
// PRIMARY: Define hook types for the 10 event types system
// =============================================================================

import type { ToolCall, ToolResult, HookContext } from "../agent/types.js"

// Re-export agent types for convenience
export type { ToolCall, ToolResult, HookContext }

// =============================================================================
// 10 Hook Event Types (per architecture spec)
// =============================================================================

export const HOOK_EVENT_NAMES = [
  "PreToolUse",       // Before tool execution — modify input or block
  "PostToolUse",      // After tool execution — modify output, log
  "PostToolUseFailure", // After tool execution fails — error handling
  "PermissionRequest", // When tool requires user approval
  "PreCompact",       // Before memory compaction — inspect/modify context
  "PostCompact",      // After memory compaction — verify result
  "SessionStart",     // When session begins — initialize session state
  "UserPromptSubmit",  // Before user prompt goes to model
  "SubagentStart",    // When a sub-agent is spawned
  "SubagentStop",     // When a sub-agent completes
  "Stop",             // When agent loop terminates
] as const

export type HookEventName = typeof HOOK_EVENT_NAMES[number]

// =============================================================================
// Tool Call Input for hooks
// =============================================================================

export interface ToolCallInput {
  toolName: string
  toolInput: Record<string, unknown>
}

// =============================================================================
// Hook Result Types
// =============================================================================

export type HookExecutionResult =
  | {
      success: true
      blocked?: never
      blockReason?: never
      modifiedInput?: Record<string, unknown>
      modifiedOutput?: unknown
      additionalContext?: string
      error?: never
    }
  | {
      success: false
      blocked: true
      blockReason?: string
      modifiedInput?: never
      modifiedOutput?: never
      additionalContext?: never
      error?: never
    }
  | {
      success: false
      blocked: false
      blockReason?: never
      modifiedInput?: never
      modifiedOutput?: never
      additionalContext?: never
      error?: string
    }

// =============================================================================
// Hook Command Types (how hooks are defined in config)
// =============================================================================

export type HookType = "command" | "prompt" | "callback"

export interface BaseHookCommand {
  type: HookType
  if?: string  // Pattern condition like "Bash(git *)"
  timeout?: number
  once?: boolean
}

export interface CommandHook extends BaseHookCommand {
  type: "command"
  command: string
  shell?: "bash" | "powershell"
}

export interface PromptHook extends BaseHookCommand {
  type: "prompt"
  prompt: string
  model?: string
}

export interface CallbackHook extends BaseHookCommand {
  type: "callback"
  callback: (input: ToolCallInput, context: HookContext) => Promise<HookResult>
  internal?: boolean
}

export type HookCommand = CommandHook | PromptHook | CallbackHook

// =============================================================================
// Hook Result for callback execution
// =============================================================================

export type HookResult =
  | { action: "continue" }
  | { action: "block"; reason: string }
  | { action: "modify"; modifiedInput?: Record<string, unknown>; modifiedOutput?: unknown }

// =============================================================================
// Hook Matcher (hooks grouped by pattern)
// =============================================================================

export interface HookMatcher {
  matcher?: string  // Pattern to match (e.g., "Write", "Bash", "*")
  hooks: HookCommand[]
}

// =============================================================================
// Hook Registry Entry
// =============================================================================

export interface RegisteredHook {
  name: string
  event: HookEventName
  command: HookCommand  // The hook command
  matcher?: string  // Optional pattern for this specific hook
  source: "settings" | "plugin" | "skill" | "session"
  pluginRoot?: string
  pluginId?: string
}
