// =============================================================================
// Distill Tool — schedule a continual-harness distillation pass.
// PRIMARY: acknowledge and return immediately. The actual LLM call
// (planner.ts) runs at the turn boundary, not inside this tool's execute() —
// rewriting the harness mid-turn would mean the model's very next tool call
// gets evaluated against a prompt it never saw. agent/loop.ts recognizes a
// "distill" tool call by name (same mechanism it already uses for "memory")
// and kicks the real distillation after the turn finishes.
// Spec: docs/superpowers/specs/2026-08-08-continual-harness-design.md, §4.6
// =============================================================================

import type { ToolContext } from "./types.js";
import type { Tool, ToolExecutionResult, JsonSchema } from "./tool.types.js";
import { buildTool } from "./factory.js";

export interface DistillParams {
  instructions?: string;
  scope?: "local" | "global";
  rollback_id?: string;
}

const distillSchema: JsonSchema = {
  type: "object",
  properties: {
    instructions: {
      type: "string",
      description:
        "Optional: focus the distillation on something specific you just noticed (a repeated failure, a corrected assumption, a procedure worth naming). Omit to let it review the whole session.",
    },
    scope: {
      type: "string",
      enum: ["local", "global"],
      description:
        "'local' (default) dies with this session — use for anything specific to the current task. 'global' persists across every future session on this machine — use only for a lesson that is true regardless of what's asked next.",
    },
    rollback_id: {
      type: "string",
      description:
        "Undo a prior distillation by its id (shown in the continual harness prompt block) instead of proposing new edits.",
    },
  },
};

function validateDistillInput(
  params: unknown,
): { valid: true } | { valid: false; error: string } {
  if (params !== undefined && params !== null && typeof params !== "object") {
    return { valid: false, error: "Expected object parameters" };
  }
  const p = (params ?? {}) as Record<string, unknown>;
  if (p.scope !== undefined && p.scope !== "local" && p.scope !== "global") {
    return {
      valid: false,
      error: `scope must be "local" or "global", received ${JSON.stringify(p.scope)}`,
    };
  }
  return { valid: true };
}

async function executeDistill(
  params: DistillParams,
  _ctx: ToolContext,
): Promise<
  ToolExecutionResult<{
    title: string;
    output: string;
    metadata?: Record<string, unknown>;
  }>
> {
  // No side effects here on purpose — see the module comment. agent/loop.ts
  // reads this call from the raw tool-call list (by tool name), not from
  // this result, to decide whether to run the real distillation.
  const scope = params.scope ?? "local";
  return {
    success: true,
    result: {
      title: params.rollback_id
        ? `Scheduled rollback of ${params.rollback_id}`
        : `Scheduled distillation (${scope})`,
      output: params.rollback_id
        ? `Will roll back distillation ${params.rollback_id} at the end of this turn.`
        : `Will review this session and propose ${scope} harness edits at the end of this turn.`,
      metadata: { scope, scheduled: true },
    },
  };
}

export const DistillTool: Tool<DistillParams> = buildTool({
  id: "distill",
  description:
    "Schedule a review of this session for the continual harness: durable notes (prompt/memory/skill/subagent) that persist and get injected into future prompts. Call this after a repeated failure, a corrected assumption, a procedure worth naming, or when a prior distillation turned out wrong (use rollback_id). Most sessions have nothing worth distilling — do not call this reflexively. Runs at the end of the turn, not immediately; this call only schedules it.",
  schemas: { parameters: distillSchema },
  permissions: { operations: ["file.write"] },
  behavior: {
    isConcurrencySafe: true,
    isDestructive: false,
    userFacingName: "Distill",
  },
  execute: executeDistill,
  validateInput: validateDistillInput,
  isSearchOrReadCommand: () => ({ isSearch: false, isRead: false }),
});
