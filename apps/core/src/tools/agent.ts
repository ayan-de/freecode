// =============================================================================
// Agent Tool - Spawn a sub-agent with UI rendering
// =============================================================================

import * as path from "path";
import * as os from "os";
import type { ToolContext } from "./types.js";
import type { Tool, ToolExecutionResult, JsonSchema } from "./tool.types.js";
import { buildTool } from "./factory.js";
import { AgentLoop } from "../agent/loop.js";
import { BusEvents } from "../bus/index.js";
import type { HookContext } from "../agent/types.js";
import type { HookRuntime } from "../hooks/runtime.js";
import { createSessionStore, type SessionStore } from "../session/store.js";
import { coerceBoolean } from "./coerce-args.js";
import { createRecorder } from "../rollout/recorder.js";

interface AgentParams {
  task: string;
  prompt: string;
  agentType?: string;
  forkContext?: boolean;
}

// =============================================================================
// Agent Schema
// =============================================================================

const agentSchema: JsonSchema = {
  type: "object",
  properties: {
    task: { type: "string", description: "Brief description of the task for the sub-agent" },
    prompt: { type: "string", description: "The actual prompt/instruction for the sub-agent" },
    agentType: {
      type: "string",
      description: "Optional: AI provider to use (e.g., 'chatgpt', 'claude')",
    },
    forkContext: {
      type: "boolean",
      description:
        "If true, the sub-agent starts with the full parent conversation forked into its own session, instead of only the task prompt. Use when the sub-agent needs this conversation's context (e.g. continuing complex work) rather than a fresh, isolated investigation.",
    },
  },
  required: ["task", "prompt"],
};

// =============================================================================
// Input validation
// =============================================================================

function validateAgentInput(
  params: unknown,
): { valid: true } | { valid: false; error: string } {
  if (!params || typeof params !== "object") {
    return { valid: false, error: "Expected object parameters" };
  }
  const p = params as Record<string, unknown>;
  if (typeof p.task !== "string" || p.task.length === 0) {
    return { valid: false, error: "task is required" };
  }
  if (typeof p.prompt !== "string" || p.prompt.length === 0) {
    return { valid: false, error: "prompt is required" };
  }
  if (
    p.forkContext !== undefined &&
    coerceBoolean(p.forkContext) === undefined
  ) {
    return { valid: false, error: "forkContext must be a boolean" };
  }
  return { valid: true };
}

// =============================================================================
// Execute subagent
// =============================================================================

async function executeSubagent(
  params: AgentParams,
  ctx: ToolContext,
  hooks: HookRuntime,
): Promise<
  ToolExecutionResult<{
    title: string;
    output: string;
    metadata?: Record<string, unknown>;
  }>
> {
  let subagentId = `subagent-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const parentSessionId = ctx.sessionId || "unknown";
  const parentRecorder = ctx.sessionId
    ? createRecorder(ctx.sessionId)
    : undefined;
  let sessionStore: SessionStore | undefined;

  if (coerceBoolean(params.forkContext) && ctx.sessionId) {
    const baseDir = path.join(os.homedir(), ".freecode");
    sessionStore = await createSessionStore(baseDir);
    subagentId = await sessionStore.fork(ctx.sessionId);
  }

  const hookCtx: HookContext = {
    sessionId: subagentId,
    turnCount: 0,
    toolName: "agent",
  };

  try {
    const startResult = await hooks.runSubagentStart(params.task, hookCtx);

    if (startResult.additionalContext) {
      console.log(`[AgentTool] SubagentStart hook added context`);
    }

    BusEvents.subagentStarted(
      subagentId,
      params.agentType || "agent",
      parentSessionId,
      params.task,
    );
    parentRecorder?.recordSubagentStart(subagentId, params.task);

    const subAgentLoop = new AgentLoop(subagentId, {
      maxIterations: 50,
      hooks,
      sessionStore,
    });

    const result = await subAgentLoop.run({
      prompt: params.prompt,
      sessionId: subagentId,
      provider: params.agentType || "chatgpt",
      projectPath: ctx.cwd,
    });

    BusEvents.subagentCompleted(
      subagentId,
      params.agentType || "agent",
      parentSessionId,
      result.success,
      result.message,
    );
    parentRecorder?.recordSubagentStop(subagentId, result.message ?? "");

    await hooks.runSubagentStop(params.task, hookCtx);

    const output = [
      `Subagent: ${params.task}`,
      `Status: ${result.success ? "SUCCESS" : "FAILED"}`,
      `Turns: ${result.turnCount}`,
      `Iterations: ${result.iterationCount}`,
      result.content ? `\nOutput:\n${result.content}` : "",
    ]
      .filter(Boolean)
      .join("\n");

    return {
      success: true,
      result: {
        title: `Agent: ${params.task}`,
        output,
        metadata: {
          subagentId,
          success: result.success,
          turns: result.turnCount,
        },
      },
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error(`[agent] Subagent ${subagentId} failed: ${errorMsg}`);

    BusEvents.subagentCompleted(
      subagentId,
      params.agentType || "agent",
      parentSessionId,
      false,
      errorMsg,
    );
    parentRecorder?.recordSubagentStop(subagentId, errorMsg);

    await hooks.runSubagentStop(
      JSON.stringify({ success: false, error: errorMsg }),
      hookCtx,
    );

    return {
      success: false,
      error: errorMsg,
    };
  }
}

// =============================================================================
// Execute function
// =============================================================================

async function executeAgent(
  params: AgentParams,
  ctx: ToolContext,
): Promise<
  ToolExecutionResult<{
    title: string;
    output: string;
    metadata?: Record<string, unknown>;
  }>
> {
  const hooks = (ctx as any).hooks as HookRuntime | undefined;

  if (!hooks) {
    const { createHookRuntime } = await import("../hooks/runtime.js");
    const defaultHooks = createHookRuntime();
    return executeSubagent(params, ctx, defaultHooks);
  }

  return executeSubagent(params, ctx, hooks);
}

// =============================================================================
// AgentTool - Built with buildTool() factory
// =============================================================================

export const AgentTool: Tool<AgentParams> = buildTool({
  id: "agent",
  description: `Run a task in a sub-agent with its own context window and get back a single summary.

Use it when the work would otherwise burn a lot of context you have no further use for — "find everywhere feature X is wired up", "work out why this test is flaky" — since only the final answer returns to this conversation. Don't use it for work you can do directly: reading a known file, a single grep, or an edit you already understand is faster inline.

- Put everything it needs in \`prompt\`. It starts cold and cannot see this conversation unless you set forkContext: true, which forks the current session into it.
- Say exactly what you want back, and whether it should investigate only or actually change code.
- Its result is not shown to the user — relay what matters yourself.`,
  schemas: {
    parameters: agentSchema,
  },
  permissions: {
    operations: ["agent.spawn"],
    requiresApproval: true,
  },
  behavior: {
    isConcurrencySafe: false,
    // A subagent runs arbitrary tools of its own and can mutate the
    // filesystem, so this must read the same as write/edit: triggers the
    // verify gate, counts toward stagnation, and is not safely retryable.
    isDestructive: true,
    interruptBehavior: "await",
    userFacingName: "Agent",
  },
  execute: executeAgent,
  validateInput: validateAgentInput,
  isSearchOrReadCommand: () => ({ isSearch: false, isRead: false }),
});
