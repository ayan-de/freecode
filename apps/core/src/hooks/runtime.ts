// =============================================================================
// Hook Runtime - Hook execution engine for FreeCode
// PRIMARY: Interception points for modifying agent behavior
// INPUT: ToolCall, ToolResult, HookContext at various lifecycle points
// OUTPUT: HookResult (can block/modify), modified ToolResult, or void
// HOOKS: PreToolUse, PostToolUse, PermissionRequest, PreCompact, PostCompact,
//        SessionStart, UserPromptSubmit, SubagentStart, SubagentStop, Stop
// PURPOSE: Allows plugins and custom behavior without modifying core loop
// =============================================================================

import type { ToolCall, ToolResult } from "../agent/types.js"
import type {
  HookContext,
  HookEventName,
  ToolCallInput,
  HookCommand,
  HookMatcher,
  RegisteredHook,
  HookExecutionResult,
  CommandHook,
  PromptHook,
  CallbackHook,
  HookResult,
} from "./types.js"
import { HOOK_EVENT_NAMES } from "./types.js"
import { runPreToolUseHooks } from "./PreToolUse.js"
import { runPostToolUseHooks } from "./PostToolUse.js"
import { runPostToolUseFailureHooks } from "./PostToolUseFailure.js"
import { runPermissionRequestHooks } from "./PermissionRequest.js"
import { runSessionStartHooks } from "./SessionStart.js"
import { runStopHooks } from "./Stop.js"
import { runPreCompactHooks } from "./PreCompact.js"
import { runPostCompactHooks } from "./PostCompact.js"
import { runUserPromptSubmitHooks } from "./UserPromptSubmit.js"
import { runSubagentStartHooks } from "./SubagentStart.js"
import { runSubagentStopHooks } from "./SubagentStop.js"
import {
  registerHook,
  unregisterHook,
  unregisterAllHooks,
  getHooksForEvent,
  getMatchingHooks,
  listRegisteredHooks,
} from "./registry.js"
import { bus } from "../bus/index.js"

// =============================================================================
// HookRuntime Interface
// =============================================================================

export interface HookRuntime {
  // Tool hooks
  runPreToolUse(tool: ToolCall, ctx: HookContext): Promise<{
    allowed: boolean
    modifiedInput?: Record<string, unknown>
    additionalContext?: string
    blockReason?: string
  }>
  runPostToolUse(
    tool: ToolCall,
    result: ToolResult,
    ctx: HookContext
  ): Promise<{
    modifiedOutput?: unknown
    additionalContext?: string
  }>
  runPostToolUseFailure(
    tool: ToolCall,
    error: string,
    ctx: HookContext
  ): Promise<{
    additionalContext?: string
    shouldRetry?: boolean
    recoveryAction?: "retry" | "skip" | "abort"
  }>
  runPermissionRequest(
    tool: ToolCall,
    ctx: HookContext
  ): Promise<{
    decision: "allow" | "deny" | "ask"
    modifiedInput?: Record<string, unknown>
    reason?: string
  }>

  // Session hooks
  runSessionStart(ctx: HookContext): Promise<{
    additionalContext?: string
    initialUserMessage?: string
  }>
  runStop(reason: string, ctx: HookContext): Promise<{
    blocked?: boolean
    blockReason?: string
  }>

  // Compact hooks
  runPreCompact(ctx: HookContext): Promise<{
    allowed: boolean
    blockReason?: string
  }>
  runPostCompact(ctx: HookContext, success: boolean): Promise<{
    additionalContext?: string
  }>

  // Prompt hooks
  runUserPromptSubmit(prompt: string, ctx: HookContext): Promise<{
    modifiedPrompt?: string
    additionalContext?: string
  }>

  // Subagent hooks
  runSubagentStart(name: string, ctx: HookContext): Promise<{
    additionalContext?: string
  }>
  runSubagentStop(name: string, ctx: HookContext): Promise<{
    additionalContext?: string
  }>

  // Utility
  getHooksForEvent(event: HookEventName): ReturnType<typeof getHooksForEvent>
  listHooks(): string
}

// =============================================================================
// Default Hook Runtime Implementation
// =============================================================================

export function createHookRuntime(): HookRuntime {
  return {
    // =========================================================================
    // PreToolUse Hook - Called before each tool execution
    // Can: modify tool input, block execution, inject context
    // =========================================================================
    async runPreToolUse(
      tool: ToolCall,
      ctx: HookContext
    ): Promise<{
      allowed: boolean
      modifiedInput?: Record<string, unknown>
      additionalContext?: string
      blockReason?: string
    }> {
      return runPreToolUseHooks(tool, ctx)
    },

    // =========================================================================
    // PostToolUse Hook - Called after each tool execution
    // Can: modify result, log, inject additional context
    // =========================================================================
    async runPostToolUse(
      tool: ToolCall,
      result: ToolResult,
      ctx: HookContext
    ): Promise<{
      modifiedOutput?: unknown
      additionalContext?: string
    }> {
      return runPostToolUseHooks(tool, result, ctx)
    },

    // =========================================================================
    // PostToolUseFailure Hook - Called after tool execution fails
    // Can: log error, trigger recovery, inject context
    // =========================================================================
    async runPostToolUseFailure(
      tool: ToolCall,
      error: string,
      ctx: HookContext
    ): Promise<{
      additionalContext?: string
      shouldRetry?: boolean
      recoveryAction?: "retry" | "skip" | "abort"
    }> {
      return runPostToolUseFailureHooks(tool, error, ctx)
    },

    // =========================================================================
    // PermissionRequest Hook - Called before executing risky tools
    // Can: request user approval, block execution
    // =========================================================================
    async runPermissionRequest(
      tool: ToolCall,
      ctx: HookContext
    ): Promise<{
      decision: "allow" | "deny" | "ask"
      modifiedInput?: Record<string, unknown>
      reason?: string
    }> {
      return runPermissionRequestHooks(tool, ctx)
    },

    // =========================================================================
    // SessionStart Hook - Called when session begins
    // Can: initialize session state, load context
    // =========================================================================
    async runSessionStart(
      ctx: HookContext
    ): Promise<{
      additionalContext?: string
      initialUserMessage?: string
    }> {
      return runSessionStartHooks(ctx)
    },

    // =========================================================================
    // Stop Hook - Called when agent loop terminates
    // Can: cleanup, final logging, notification
    // =========================================================================
    async runStop(
      reason: string,
      ctx: HookContext
    ): Promise<{
      blocked?: boolean
      blockReason?: string
    }> {
      return runStopHooks(reason, ctx)
    },

    // =========================================================================
    // PreCompact Hook - Called before memory compaction
    // Can: inspect context, modify before compaction
    // =========================================================================
    async runPreCompact(
      ctx: HookContext
    ): Promise<{
      allowed: boolean
      blockReason?: string
    }> {
      return runPreCompactHooks(ctx)
    },

    // =========================================================================
    // PostCompact Hook - Called after memory compaction
    // Can: verify result, inject additional context
    // =========================================================================
    async runPostCompact(
      ctx: HookContext,
      success: boolean
    ): Promise<{
      additionalContext?: string
    }> {
      return runPostCompactHooks(ctx, success)
    },

    // =========================================================================
    // UserPromptSubmit Hook - Called before user prompt goes to model
    // Can: modify prompt, inject context
    // =========================================================================
    async runUserPromptSubmit(
      prompt: string,
      ctx: HookContext
    ): Promise<{
      modifiedPrompt?: string
      additionalContext?: string
    }> {
      return runUserPromptSubmitHooks(prompt, ctx)
    },

    // =========================================================================
    // SubagentStart Hook - Called when a subagent is spawned
    // Can: initialize subagent context
    // =========================================================================
    async runSubagentStart(
      name: string,
      ctx: HookContext
    ): Promise<{
      additionalContext?: string
    }> {
      return runSubagentStartHooks(name, ctx)
    },

    // =========================================================================
    // SubagentStop Hook - Called when a subagent completes
    // Can: collect results, cleanup
    // =========================================================================
    async runSubagentStop(
      name: string,
      ctx: HookContext
    ): Promise<{
      additionalContext?: string
    }> {
      return runSubagentStopHooks(name, ctx)
    },

    // =========================================================================
    // Utility Methods
    // =========================================================================
    getHooksForEvent(event: HookEventName) {
      return getHooksForEvent(event)
    },

    listHooks() {
      return listRegisteredHooks()
    },
  }
}

// =============================================================================
// Global Hook Runtime Instance
// =============================================================================

let hookRuntime: HookRuntime | null = null

export function getHookRuntime(): HookRuntime {
  if (!hookRuntime) {
    hookRuntime = createHookRuntime()
  }
  return hookRuntime
}

export function resetHookRuntime(): void {
  hookRuntime = null
}

// =============================================================================
// Export types and registry for external use
// =============================================================================

export {
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
  registerHook,
  unregisterHook,
  unregisterAllHooks,
  getMatchingHooks,
  getHooksForEvent,
  listRegisteredHooks,
  // Individual hook handlers
  runPreToolUseHooks,
  runPostToolUseHooks,
  runPostToolUseFailureHooks,
  runPermissionRequestHooks,
  runPreCompactHooks,
  runPostCompactHooks,
  runSessionStartHooks,
  runUserPromptSubmitHooks,
  runSubagentStartHooks,
  runSubagentStopHooks,
  runStopHooks,
}
