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
import { getOutputStore, adaptiveTruncate } from "./output-store/index.js";
import { maybeCompressOutput } from "./output-compress.js";
import { coerceArgs } from "./coerce-args.js";
import { logger } from "../utils/logger.js";

// Cap on the UI-bound copy of a tool result (displayOutput/stdout). Formerly
// bash's own 500KB pre-store cap; it lives here so it applies after the
// OutputStore put and to every tool, not just bash.
const MAX_DISPLAY_CHARS = 500_000;

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
      const { id: toolId, tool } = call;

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

      // 1.5 Normalize quoted scalars ("30" → 30) against the declared schema,
      // before validation and permissions so every downstream step sees the
      // same coerced args. Without this a provider that stringifies numbers is
      // rejected by validateToolInput and re-sends the identical call.
      const args = coerceArgs(toolDef.schemas?.parameters, call.args);

      // 1.75 Required-argument check against the declared schema. Catches
      // what a tool's own validateInput doesn't bother re-checking (MCP tools
      // define none), so a missing required arg fails here instead of
      // surfacing as `undefined` inside the remote/tool call.
      const schemaError = validateParams(
        args,
        toolDef.schemas?.parameters?.required ?? [],
        toolDef.schemas?.parameters?.properties ?? {},
      );
      if (schemaError) {
        return {
          id: `result-${Date.now()}`,
          toolCallId: toolId,
          tool,
          title: toolDef.description,
          error: schemaError.message,
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
            logger.warn(
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
        // Success case. Tools built via factory.ts return a structured
        // `{ title, output, metadata }`; unwrap `.output` so the diff/text
        // reaches the frontend as-is. Only a bare string or other shape falls
        // back to JSON. (A raw object without `.output` still stringifies.)
        const r = execResult.result as unknown;
        const structured =
          r && typeof r === "object" && typeof (r as any).output === "string"
            ? (r as { title?: string; output: string; metadata?: Record<string, unknown> })
            : null;
        const output = structured
          ? structured.output
          : typeof r === "string"
            ? r
            : JSON.stringify(r);
        // Stash the FULL output so the `output` tool can page it later, then cap
        // what the model sees to head+tail. A store miss later degrades to
        // "re-run the tool" (spec D4) — never fatal, so this put is best-effort.
        if (ctx.sessionId) getOutputStore(ctx.sessionId).put(toolId, output);
        // Content-aware view for the model (flag-gated, spec 2026-09-04 D2):
        // runs after the put like every lossy cap, so the elided lines stay
        // pageable. adaptiveTruncate still enforces the hard char budget.
        const view = maybeCompressOutput(
          output,
          structured?.metadata?.outputKind,
          toolId,
        );
        const { modelOutput, truncated } = adaptiveTruncate(view, toolId);
        // The UI copy is capped only AFTER the put — the store must hold the
        // full text or the `output` tool can never page past the cap
        // (spec 2026-09-04-harness-cost-efficiency.md D1). Tail-keep: the end
        // of tool output (errors, summaries) is worth more on screen than the
        // head, which stays retrievable from the store.
        const display =
          output.length > MAX_DISPLAY_CHARS
            ? `[showing last ${MAX_DISPLAY_CHARS} chars; full output available via the output tool]\n` +
              output.slice(-MAX_DISPLAY_CHARS)
            : output;
        return {
          id: `result-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          toolCallId: toolId,
          tool,
          title: structured?.title ?? toolDef.description,
          displayOutput: display,
          modelOutput,
          stdout: display, // Legacy
          structuredData: structured?.metadata,
          // Compression is truncation too: the model is not seeing everything,
          // even when the char budget never tripped.
          truncated: truncated || view !== output,
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
