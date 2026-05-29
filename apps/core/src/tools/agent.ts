// =============================================================================
// agent Tool - Spawn a sub-agent to handle independent tasks
// PRIMARY: Allow main agent to fork parallel sub-sessions
// INPUT: { task: string, prompt: string, agentType?: string }
// OUTPUT: Subagent result with stdout, success status
// LIFECYCLE: runSubagentStart hook → spawn → run → runSubagentStop hook
// =============================================================================

import type { ToolDef, ToolContext, ToolResult } from "./types"
import { AgentLoop } from "../agent/loop.js"
import { createInitialSessionState } from "../agent/types.js"
import { bus, BusEvents } from "../bus/index.js"
import type { HookContext } from "../agent/types.js"
import type { HookRuntime } from "../hooks/runtime.js"

export interface AgentParams {
  task: string
  prompt: string
  agentType?: string
}

/**
 * Execute a subagent task in a forked session
 */
async function executeSubagent(
  params: AgentParams,
  ctx: ToolContext,
  hooks: HookRuntime
): Promise<ToolResult> {
  const subagentId = `subagent-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
  const parentSessionId = ctx.sessionId || "unknown"

  // Build hook context for subagent lifecycle
  const hookCtx: HookContext = {
    sessionId: subagentId,
    turnCount: 0,
    toolName: "agent",
  }

  // Record start time for duration calculation
  const startTime = Date.now()

  try {
    // Run SubagentStart hook — can modify params or block spawning
    const startResult = await hooks.runSubagentStart(
      { id: subagentId, tool: "agent", args: params, execution: "sequential" },
      hookCtx
    )

    if (startResult.action === "block") {
      console.warn(`[agent] Subagent blocked: ${startResult.reason ?? "no reason"}`)
      return {
        title: `Agent: ${params.task}`,
        output: `Blocked by hook: ${startResult.reason ?? "no reason"}`,
      }
    }

    // Inject context if hook requested
    if (startResult.action === "inject" && startResult.injectContext) {
      params = { ...params, ...startResult.injectContext } as AgentParams
    }

    // Emit subagent.started Bus event
    BusEvents.subagentStarted(subagentId, parentSessionId, params.task)

    console.log(`[agent] Spawning subagent ${subagentId} for task: ${params.task}`)

    // Create a new AgentLoop for the subagent
    const subAgentLoop = new AgentLoop(subagentId, {
      maxIterations: 50,
      hooks,
    })

    // Run the subagent with the provided prompt
    const result = await subAgentLoop.run({
      prompt: params.prompt,
      sessionId: subagentId,
      provider: params.agentType || "chatgpt",
      projectPath: ctx.cwd,
    })

    // Calculate duration
    const duration_ms = Date.now() - startTime

    // Emit subagent.completed Bus event
    BusEvents.subagentCompleted(subagentId, parentSessionId, result.message || "completed")

    // Run SubagentStop hook — can process result, log
    await hooks.runSubagentStop(
      JSON.stringify({ success: result.success, message: result.message }),
      hookCtx
    )

    // Format result for main agent
    const output = [
      `Subagent: ${params.task}`,
      `Status: ${result.success ? "SUCCESS" : "FAILED"}`,
      `Turns: ${result.turnCount}`,
      `Iterations: ${result.iterationCount}`,
      result.content ? `\nOutput:\n${result.content}` : "",
    ].filter(Boolean).join("\n")

    return {
      title: `Agent: ${params.task}`,
      output: output,
      metadata: { subagentId, success: result.success, turns: result.turnCount },
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error)
    console.error(`[agent] Subagent ${subagentId} failed: ${errorMsg}`)

    // Emit error event
    BusEvents.subagentCompleted(subagentId, parentSessionId, `ERROR: ${errorMsg}`)

    // Run SubagentStop hook with error
    await hooks.runSubagentStop(
      JSON.stringify({ success: false, error: errorMsg }),
      hookCtx
    )

    return {
      title: `Agent: ${params.task}`,
      output: `ERROR: ${errorMsg}`,
      metadata: { subagentId, success: false, error: errorMsg },
    }
  }
}

export const AgentTool: ToolDef<AgentParams> = {
  id: "agent",
  description:
    "Spawn a sub-agent to handle an independent task in parallel. Use when a task can be delegated while the main agent works on something else. The sub-agent runs independently and returns its result.",
  parameters: {
    type: "object",
    properties: {
      task: {
        type: "string",
        description: "Brief description of the task for the sub-agent",
      },
      prompt: {
        type: "string",
        description: "The actual prompt/instruction for the sub-agent to execute",
      },
      agentType: {
        type: "string",
        description: "Optional: AI provider to use (e.g., 'chatgpt', 'claude'). Defaults to 'chatgpt'",
      },
    },
    required: ["task", "prompt"],
  },
  execute: async (params: AgentParams, ctx: ToolContext): Promise<ToolResult> => {
    // Get the hook runtime from context if available
    const hooks = (ctx as any).hooks as HookRuntime | undefined

    if (!hooks) {
      // Fallback: create a default hook runtime
      const { createHookRuntime } = await import("../hooks/runtime.js")
      const defaultHooks = createHookRuntime()
      return executeSubagent(params, ctx, defaultHooks)
    }

    return executeSubagent(params, ctx, hooks)
  },
}