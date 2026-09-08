// =============================================================================
// KillBash Tool - stop a background shell.
//
// SIGTERMs the whole process group, not just the shell, so a dev server's
// grandchildren go down with it. Mutating (it stops a running process), so it
// is blocked in the read-only modes like any other side-effecting tool.
// =============================================================================

import type { ToolContext } from "./types.js";
import type { Tool, ToolExecutionResult, JsonSchema } from "./tool.types.js";
import { buildTool } from "./factory.js";
import { peekShellRegistry } from "./shells/index.js";

interface KillBashParams {
  bash_id: string;
}

const killBashSchema: JsonSchema = {
  type: "object",
  properties: {
    bash_id: {
      type: "string",
      description: "The shell id to stop, e.g. bash_1.",
    },
  },
  required: ["bash_id"],
};

function validateKillBashInput(
  params: unknown,
): { valid: true } | { valid: false; error: string } {
  if (!params || typeof params !== "object") {
    return { valid: false, error: "Expected object parameters" };
  }
  const p = params as Record<string, unknown>;
  if (typeof p.bash_id !== "string" || p.bash_id.length === 0) {
    return { valid: false, error: "bash_id is required and must be a string" };
  }
  return { valid: true };
}

async function executeKillBash(
  params: KillBashParams,
  ctx: ToolContext,
): Promise<
  ToolExecutionResult<{
    title: string;
    output: string;
    metadata?: Record<string, unknown>;
  }>
> {
  const registry = ctx.sessionId ? peekShellRegistry(ctx.sessionId) : undefined;
  const summary = registry?.get(params.bash_id);

  if (!registry || !summary) {
    return {
      success: true,
      result: {
        title: params.bash_id,
        output: `No background shell ${params.bash_id} in this session.`,
        metadata: { shellId: params.bash_id, killed: false },
      },
    };
  }

  const killed = registry.kill(params.bash_id);
  return {
    success: true,
    result: {
      title: summary.command.split("\n")[0].slice(0, 50),
      output: killed
        ? `Killed ${params.bash_id}. Any output it produced is still readable with bashoutput.`
        : `${params.bash_id} had already finished (${summary.status}).`,
      metadata: { shellId: params.bash_id, killed },
    },
  };
}

export const KillBashTool: Tool<KillBashParams> = buildTool({
  id: "killbash",
  description:
    "Stop a background shell started with bash(run_in_background: true), terminating its whole process tree. Its buffered output stays readable with bashoutput.",
  schemas: {
    parameters: killBashSchema,
  },
  permissions: {
    operations: ["shell"],
    requiresApproval: false,
  },
  behavior: {
    isConcurrencySafe: false,
    isDestructive: false,
    interruptBehavior: "await",
    userFacingName: "KillBash",
  },
  execute: executeKillBash,
  validateInput: validateKillBashInput,
  isSearchOrReadCommand: () => ({ isSearch: false, isRead: false }),
});
