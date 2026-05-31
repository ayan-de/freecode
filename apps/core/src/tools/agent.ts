// =============================================================================
// Agent Tool - Spawn a sub-agent with UI rendering
// =============================================================================

import type { ToolContext } from "./types"
import type { Tool, ToolExecutionResult, JsonSchema } from "./tool.types"
import { buildTool, defaultToolUI } from "./factory"
import { agentToolUI } from "./agent/ui"
import { AgentLoop } from "../agent/loop.js"
import { bus, BusEvents } from "../bus/index.js"
import type { HookContext } from "../agent/types.js"
import type { HookRuntime } from "../hooks/runtime.js"

interface AgentParams {
  task: string
  prompt: string
  agentType?: string
}

// =============================================================================
// Agent Schema
// =============================================================================

const agentSchema: JsonSchema = {
  type: "object",
  properties: {
    task: { description: "Brief description of the task for the sub-agent" },
    prompt: { description: "The actual prompt/instruction for the sub-agent" },
    agentType: { description: "Optional: AI provider to use (e.g., 'chatgpt', 'claude')" },
  },
  required: ["task", "prompt"],
}

// =============================================================================
// Input validation
// =============================================================================

function validateAgentInput(params: unknown): { valid: true } | { valid: false; error: string } {
  if (!params || typeof params !== "object") {
    return { valid: false, error: "Expected object parameters" }
  }
  const p = params as Record<string, unknown>
  if (typeof p.task !== "string" || p.task.length === 0) {
    return { valid: false, error: "task is required" }
  }
  if (typeof p.prompt !== "string" || p.prompt.length === 0) {
    return { valid: false, error: "prompt is required" }
  }
  return { valid: true }
}

// =============================================================================
// Execute subagent
// =============================================================================

async function executeSubagent(
  params: AgentParams,
  ctx: ToolContext,
  hooks: HookRuntime
): Promise<ToolExecutionResult<{ title: string; output: string; metadata?: Record<string, unknown> }>> {
  const subagentId = `subagent-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
  const parentSessionId = ctx.sessionId || "unknown"

  const hookCtx: HookContext = {
    sessionId: subagentId,
    turnCount: 0,
    toolName: "agent",
  }

  const startTime = Date.now()

  try {
    const startResult = await hooks.runSubagentStart(
      { id: subagentId, tool: "agent", args: params, execution: "sequential" },
      hookCtx
    )

    if (startResult.action === "block") {
      return {
        success: false,
        error: `Blocked by hook: ${startResult.reason ?? "no reason"}`,
      }
    }

    if (startResult.action === "inject" && startResult.injectContext) {
      params = { ...params, ...startResult.injectContext } as AgentParams
    }

    BusEvents.subagentStarted(subagentId, parentSessionId, params.task)

    const subAgentLoop = new AgentLoop(subagentId, {
      maxIterations: 50,
      hooks,
    })

    const result = await subAgentLoop.run({
      prompt: params.prompt,
      sessionId: subagentId,
      provider: params.agentType || "chatgpt",
      projectPath: ctx.cwd,
    })

    const duration_ms = Date.now() - startTime

    BusEvents.subagentCompleted(subagentId, parentSessionId, result.message || "completed")

    await hooks.runSubagentStop(
      JSON.stringify({ success: result.success, message: result.message }),
      hookCtx
    )

    const output = [
      `Subagent: ${params.task}`,
      `Status: ${result.success ? "SUCCESS" : "FAILED"}`,
      `Turns: ${result.turnCount}`,
      `Iterations: ${result.iterationCount}`,
      result.content ? `\nOutput:\n${result.content}` : "",
    ].filter(Boolean).join("\n")

    return {
      success: true,
      result: {
        title: `Agent: ${params.task}`,
        output,
        metadata: { subagentId, success: result.success, turns: result.turnCount },
      },
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error)
    console.error(`[agent] Subagent ${subagentId} failed: ${errorMsg}`)

    BusEvents.subagentCompleted(subagentId, parentSessionId, `ERROR: ${errorMsg}`)

    await hooks.runSubagentStop(
      JSON.stringify({ success: false, error: errorMsg }),
      hookCtx
    )

    return {
      success: false,
      error: errorMsg,
    }
  }
}

// =============================================================================
// Execute function
// =============================================================================

async function executeAgent(
  params: AgentParams,
  ctx: ToolContext
): Promise<ToolExecutionResult<{ title: string; output: string; metadata?: Record<string, unknown> }>> {
  const hooks = (ctx as any).hooks as HookRuntime | undefined

  if (!hooks) {
    const { createHookRuntime } = await import("../hooks/runtime.js")
    const defaultHooks = createHookRuntime()
    return executeSubagent(params, ctx, defaultHooks)
  }

  return executeSubagent(params, ctx, hooks)
}

// =============================================================================
// AgentTool - Built with buildTool() factory
// =============================================================================

export const AgentTool: Tool<AgentParams> = buildTool({
  id: "agent",
  description: "Spawn a sub-agent to handle an independent task in parallel",
  schemas: {
    parameters: agentSchema,
  },
  permissions: {
    operations: ["agent.spawn"],
    requiresApproval: true,
  },
  behavior: {
    isConcurrencySafe: false,
    isDestructive: false,
    interruptBehavior: "await",
    userFacingName: "Agent",
  },
  ui: {
    ...defaultToolUI,
    ...agentToolUI,
  },
  execute: executeAgent,
  validateInput: validateAgentInput,
  isSearchOrReadCommand: () => ({ isSearch: false, isRead: false }),
})
