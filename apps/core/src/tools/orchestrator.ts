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

import type { ToolCall, ToolResult } from "../agent/types.js";
import { getTool, type ToolContext } from "./index.js";
import { isToolAllowed, type PermissionProfile } from "../permission/index.js";
import type { Tool } from "./tool.types.js";
import { isTransientError } from "../agent/recovery/manager.js";

// Max output length for model (truncation to save tokens)
const MAX_MODEL_OUTPUT_CHARS = 500;

// =============================================================================
// Orchestrator Interface
// =============================================================================

export interface ToolOrchestrator {
  execute(call: ToolCall, ctx: ToolContext): Promise<ToolResult>;
  canExecute(tool: string): boolean;
}

// =============================================================================
// Orchestrator Options
// =============================================================================

export interface OrchestratorOptions {
  permissionProfile?: PermissionProfile;
}

// =============================================================================
// Error types for detailed error reporting
// =============================================================================

export class ToolNotFoundError extends Error {
  constructor(tool: string) {
    super(`Tool '${tool}' not found`);
    this.name = "ToolNotFoundError";
  }
}

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

// =============================================================================
// validateParams()
// Check required params present, types match
// =============================================================================

function validateParams(
  params: unknown,
  required: string[],
  properties: Record<string, { type?: string } | undefined>,
): ValidationError | null {
  if (typeof params !== "object" || params === null) {
    return new ValidationError(`Expected object, got ${typeof params}`);
  }

  for (const key of required) {
    if (!(key in params)) {
      return new ValidationError(`Missing required param: ${key}`);
    }
  }

  return null;
}

// =============================================================================
// mapToolResult()
// Bridge from tools/types.ts ToolResult → agent/types.ts ToolResult
// =============================================================================

function mapToolResult(
  toolResult: {
    title: string;
    output: string;
    metadata?: Record<string, unknown>;
    error?: string;
  },
  call: ToolCall,
): ToolResult {
  const output = toolResult.output;
  const truncated = output.length > MAX_MODEL_OUTPUT_CHARS;

  return {
    id: `result-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    toolCallId: call.id,
    tool: call.tool,
    title: toolResult.title,
    displayOutput: output,
    modelOutput: truncated
      ? output.slice(0, MAX_MODEL_OUTPUT_CHARS) + "..."
      : output,
    stdout: toolResult.output, // Legacy
    stderr: toolResult.error,
    structuredData: toolResult.metadata ?? undefined,
    truncated,
  };
}

// =============================================================================
// validateToolInput()
// Call per-tool validateInput hook if present
// =============================================================================

function validateToolInput(
  tool: Tool,
  params: unknown,
): { valid: true } | { valid: false; error: string } | null {
  if (tool.validateInput) {
    return tool.validateInput(params);
  }
  return null;
}

// =============================================================================
// checkToolPermissions()
// Call per-tool checkPermissions hook if present
// =============================================================================

async function checkToolPermissions(
  tool: Tool,
  params: unknown,
  ctx: ToolContext,
): Promise<{ allowed: boolean; reason?: string } | null> {
  if (tool.checkPermissions) {
    return await tool.checkPermissions(params as any, ctx);
  }
  return null;
}

// =============================================================================
// Default tool context when none provided
// =============================================================================

const defaultToolContext: ToolContext = {
  cwd: process.cwd(),
  sessionId: "",
};

// =============================================================================
// createToolOrchestrator()
// Factory function with optional permission profile
// =============================================================================

export function createToolOrchestrator(
  opts: OrchestratorOptions = {},
): ToolOrchestrator {
  const { permissionProfile } = opts;

  return {
    // ===========================================================================
    // execute()
    // Main entry point: find tool, validate, execute, return result
    // ===========================================================================
    async execute(
      call: ToolCall,
      ctx: ToolContext = defaultToolContext,
    ): Promise<ToolResult> {
      const { id: toolId, tool, args } = call;

      // 0. Permission check (orchestrator level)
      if (permissionProfile) {
        const permCheck = isToolAllowed(tool, permissionProfile);
        if (!permCheck.allowed) {
          return {
            id: `result-${Date.now()}`,
            toolCallId: toolId,
            tool,
            title: `Tool ${tool}`,
            error: `Permission denied: ${permCheck.reason}`,
          };
        }
      }

      // 1. Look up tool
      const toolDef = getTool(tool) as Tool | undefined;
      if (!toolDef) {
        return {
          id: `result-${Date.now()}`,
          toolCallId: toolId,
          tool,
          title: `Tool ${tool}`,
          error: `Tool '${tool}' not found`,
        };
      }

      // 2. Per-tool input validation
      const validationResult = validateToolInput(toolDef, args);
      if (validationResult && !validationResult.valid) {
        return {
          id: `result-${Date.now()}`,
          toolCallId: toolId,
          tool,
          title: toolDef.description,
          error: validationResult.error,
        };
      }

      // 3. Per-tool permission check
      const permResult = await checkToolPermissions(toolDef, args, ctx);
      if (permResult && !permResult.allowed) {
        return {
          id: `result-${Date.now()}`,
          toolCallId: toolId,
          tool,
          title: toolDef.description,
          error: `Permission denied: ${permResult.reason ?? "check failed"}`,
        };
      }

      // 4. Execute — with the Phase 4 tool retry rule: non-mutating tools
      // (isDestructive=false) retry a transient failure once; mutating tools
      // never retry (re-running a write/edit/bash is not safe).
      const maxAttempts = toolDef.behavior?.isDestructive === false ? 2 : 1;
      let attempt = 0;
      try {
        let execResult;
        for (;;) {
          attempt++;
          try {
            execResult = await toolDef.execute(
              args as Record<string, unknown>,
              ctx,
            );
            break;
          } catch (err) {
            if (
              attempt >= maxAttempts ||
              !isTransientError(err) ||
              ctx.abort?.aborted
            ) {
              throw err;
            }
            console.warn(
              `[Orchestrator] Tool ${tool} transient failure (attempt ${attempt}/${maxAttempts}); retrying`,
            );
            await new Promise((r) => setTimeout(r, 200 * attempt));
          }
        }
        // Handle ToolExecutionResult discriminated union
        if (!execResult.success) {
          return {
            id: `result-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            toolCallId: toolId,
            tool,
            title: toolDef.description,
            error: execResult.error,
          };
        }
        // Success case - result.result is the tool output
        const output =
          typeof execResult.result === "string"
            ? execResult.result
            : JSON.stringify(execResult.result);
        const truncated = output.length > MAX_MODEL_OUTPUT_CHARS;
        return {
          id: `result-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          toolCallId: toolId,
          tool,
          title: toolDef.description,
          displayOutput: output,
          modelOutput: truncated
            ? output.slice(0, MAX_MODEL_OUTPUT_CHARS) + "..."
            : output,
          stdout: output, // Legacy
          truncated,
        };
      } catch (err) {
        return {
          id: `result-${Date.now()}`,
          toolCallId: toolId,
          tool,
          title: toolDef.description,
          error: String(err),
        };
      }
    },

    // ===========================================================================
    // canExecute()
    // Quick check if tool is registered
    // ===========================================================================
    canExecute(tool: string): boolean {
      if (permissionProfile) {
        return (
          isToolAllowed(tool, permissionProfile).allowed &&
          getTool(tool) !== undefined
        );
      }
      return getTool(tool) !== undefined;
    },
  };
}
