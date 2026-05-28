// =============================================================================
// Hook Runtime - 10 hook event types for extensibility
// PRIMARY: Interception points for modifying agent behavior
// INPUT: ToolCall, ToolResult, HookContext at various lifecycle points
// OUTPUT: HookResult (can block/modify), modified ToolResult, or void
// HOOKS: PreToolUse, PostToolUse, PreCompact, PostCompact, SessionStart, UserPromptSubmit, SubagentStart, SubagentStop, Stop
// PURPOSE: Allows plugins and custom behavior without modifying core loop
// =============================================================================

import type { ToolCall, ToolResult, HookContext, HookResult } from "../agent/types.js"

// =============================================================================
// HookRuntime Interface
// =============================================================================
export interface HookRuntime {
  runPreToolUse(tool: ToolCall, ctx: HookContext): Promise<HookResult>
  runPostToolUse(tool: ToolCall, result: ToolResult, ctx: HookContext): Promise<ToolResult>
  runPreCompact(context: HookContext): Promise<HookResult>
  runPostCompact(context: HookContext): Promise<void>
  runSessionStart(session: { status: string; sessionId: string }): Promise<void>
  runUserPromptSubmit(prompt: string): Promise<string>
  runStop(reason: string): Promise<void>
}

// =============================================================================
// 10 Hook Event Types
// const HOOK_EVENT_NAMES = [
//   "PreToolUse",       // Before tool execution — modify input or block
//   "PostToolUse",      // After tool execution — modify output, log
//   "PermissionRequest", // When tool requires user approval
//   "PreCompact",       // Before memory compaction — inspect/modify context
//   "PostCompact",      // After memory compaction — verify result
//   "SessionStart",     // When session begins — initialize session state
//   "UserPromptSubmit",  // Before user prompt goes to model
//   "SubagentStart",    // When a sub-agent is spawned
//   "SubagentStop",     // When a sub-agent completes
//   "Stop",             // When agent loop terminates
// ] as const;
// =============================================================================

// =============================================================================
// createHookRuntime - Factory function
// Returns default hook runtime (no-ops for all hooks)
// Replace with actual implementations for custom behavior
// =============================================================================
export const createHookRuntime = (): HookRuntime => ({
  // ===========================================================================
  // PreToolUse Hook - Called before each tool execution
  // Can: modify tool input, block execution, inject context
  // ===========================================================================
  async runPreToolUse(_tool: ToolCall, _ctx: HookContext): Promise<HookResult> {
    return { action: "continue" }
  },

  // ===========================================================================
  // PostToolUse Hook - Called after each tool execution
  // Can: modify result, log, inject additional context
  // ===========================================================================
  async runPostToolUse(_tool: ToolCall, result: ToolResult, _ctx: HookContext): Promise<ToolResult> {
    return result
  },

  // ===========================================================================
  // PreCompact Hook - Called before memory compaction
  // Can: inspect context, modify what gets compacted
  // ===========================================================================
  async runPreCompact(_context: HookContext): Promise<HookResult> {
    return { action: "continue" }
  },

  // ===========================================================================
  // PostCompact Hook - Called after memory compaction completes
  // Can: verify compaction result, log summary
  // ===========================================================================
  async runPostCompact(_context: HookContext): Promise<void> {
    // no-op by default
  },

  // ===========================================================================
  // SessionStart Hook - Called when session begins
  // Can: initialize session state, load context
  // ===========================================================================
  async runSessionStart(_session: { status: string; sessionId: string }): Promise<void> {
    // no-op by default
  },

  // ===========================================================================
  // UserPromptSubmit Hook - Called before user prompt goes to model
  // Can: modify prompt, add context, filter content
  // ===========================================================================
  async runUserPromptSubmit(prompt: string): Promise<string> {
    return prompt
  },

  // ===========================================================================
  // Stop Hook - Called when agent loop terminates
  // Can: cleanup, final logging, notification
  // ===========================================================================
  async runStop(_reason: string): Promise<void> {
    // no-op by default
  },
})