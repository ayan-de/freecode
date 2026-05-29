// =============================================================================
// Tool Orchestrator - Executes tool calls from the agent loop
// PRIMARY: Bridges AgentLoop → ToolRegistry execution
// INPUT: ToolCall (id, tool, args), ToolContext (cwd, abort)
// OUTPUT: ToolResult (agent/types.ts format)
// RESPONSIBILITIES:
//   - Tool lookup via getTool()
//   - Permission checking against profile
//   - Param validation against JSON schema
//   - Execution via tool.execute()
//   - Error mapping (not found, validation, runtime)
//   - Result format bridging (tools/types.ts → agent/types.ts)
// =============================================================================

import type { ToolCall, ToolResult } from "../agent/types.js"
import { getTool, type ToolContext } from "./index.js"
import { isToolAllowed, type PermissionProfile } from "../permission/index.js"

// =============================================================================
// Orchestrator Interface
// =============================================================================

export interface ToolOrchestrator {
  execute(call: ToolCall, ctx: ToolContext): Promise<ToolResult>
  canExecute(tool: string): boolean
}

// =============================================================================
// Orchestrator Options
// =============================================================================

export interface OrchestratorOptions {
  permissionProfile?: PermissionProfile
}

// =============================================================================
// Error types for detailed error reporting
// =============================================================================

export class ToolNotFoundError extends Error {
  constructor(tool: string) {
    super(`Tool '${tool}' not found`)
    this.name = "ToolNotFoundError"
  }
}

export class ValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ValidationError"
  }
}

// =============================================================================
// validateParams()
// Check required params present, types match
// =============================================================================

function validateParams(
  params: unknown,
  required: string[],
  properties: Record<string, { type?: string } | undefined>
): ValidationError | null {
  if (typeof params !== "object" || params === null) {
    return new ValidationError(`Expected object, got ${typeof params}`)
  }

  for (const key of required) {
    if (!(key in params)) {
      return new ValidationError(`Missing required param: ${key}`)
    }
  }

  return null
}

// =============================================================================
// mapToolResult()
// Bridge from tools/types.ts ToolResult → agent/types.ts ToolResult
// =============================================================================

function mapToolResult(
  toolResult: { title: string; output: string; metadata?: Record<string, unknown> },
  call: ToolCall
): ToolResult {
  return {
    id: `result-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    toolCallId: call.id,
    tool: call.tool,
    title: toolResult.title,
    stdout: toolResult.output,
    structuredData: toolResult.metadata ?? undefined,
  }
}

// =============================================================================
// Default tool context when none provided
// =============================================================================

const defaultToolContext: ToolContext = {
  cwd: process.cwd(),
}

// =============================================================================
// createToolOrchestrator()
// Factory function with optional permission profile
// =============================================================================

export function createToolOrchestrator(opts: OrchestratorOptions = {}): ToolOrchestrator {
  const { permissionProfile } = opts

  return {
    // ===========================================================================
    // execute()
    // Main entry point: find tool, validate, execute, return result
    // ===========================================================================
    async execute(call: ToolCall, ctx: ToolContext = defaultToolContext): Promise<ToolResult> {
      const { id: toolId, tool, args } = call

      // 0. Permission check
      if (permissionProfile) {
        const permCheck = isToolAllowed(tool, permissionProfile)
        if (!permCheck.allowed) {
          return {
            id: `result-${Date.now()}`,
            toolCallId: toolId,
            tool,
            title: `Tool ${tool}`,
            error: `Permission denied: ${permCheck.reason}`,
          }
        }
      }

      // 1. Look up tool
      const toolDef = getTool(tool)
      if (!toolDef) {
        return {
          id: `result-${Date.now()}`,
          toolCallId: toolId,
          tool,
          title: `Tool ${tool}`,
          error: `Tool '${tool}' not found`,
        }
      }

      // 2. Validate params
      const schema = toolDef.parameters
      const required = schema.required ?? []
      const properties = schema.properties ?? {}
      const validationError = validateParams(args, required, properties)
      if (validationError) {
        return {
          id: `result-${Date.now()}`,
          toolCallId: toolId,
          tool,
          title: toolDef.description,
          error: validationError.message,
        }
      }

      // 3. Execute
      try {
        const result = await toolDef.execute(args as Record<string, unknown>, ctx)
        return mapToolResult(result, call)
      } catch (err) {
        return {
          id: `result-${Date.now()}`,
          toolCallId: toolId,
          tool,
          title: toolDef.description,
          error: String(err),
        }
      }
    },

    // ===========================================================================
    // canExecute()
    // Quick check if tool is registered
    // ===========================================================================
    canExecute(tool: string): boolean {
      if (permissionProfile) {
        return isToolAllowed(tool, permissionProfile).allowed && getTool(tool) !== undefined
      }
      return getTool(tool) !== undefined
    },
  }
}