// =============================================================================
// Output Tool - page through the FULL output of an earlier tool call.
// The orchestrator caps what the model sees (adaptiveTruncate) but stashes the
// whole output in the per-session OutputStore keyed by toolCallId. This tool
// reads a slice (offset/limit) or greps it — so the model recovers the omitted
// middle/tail WITHOUT re-running the original command (spec D3).
//
// Read-only: safe in every mode. A store miss (evicted / restarted) returns a
// clear message telling the model to re-run the original tool (spec D4) — never
// an error, never throws.
// =============================================================================

import type { ToolContext } from "./types.js";
import type { Tool, ToolExecutionResult, JsonSchema } from "./tool.types.js";
import { buildTool, defaultToolUI } from "./factory.js";
import { coerceNumber } from "./read.js";
import { getOutputStore, adaptiveTruncate } from "./output-store/index.js";
import { DEFAULT_LINES } from "./output-store/config.js";
import { outputToolUI } from "./output/ui.js";

interface OutputParams {
  id: string;
  offset?: number;
  limit?: number;
  pattern?: string;
  context?: number;
}

const outputSchema: JsonSchema = {
  type: "object",
  properties: {
    id: {
      type: "string",
      description:
        "The toolCallId of the earlier tool call whose full output you want (shown in the truncation marker).",
    },
    offset: {
      type: "number",
      description: "1-based line to start from (default 1). Ignored if pattern is set.",
    },
    limit: {
      type: "number",
      description: `Max lines to return (default ${DEFAULT_LINES}). Ignored if pattern is set.`,
    },
    pattern: {
      type: "string",
      description:
        "Optional regex (falls back to literal substring) — return only matching lines with their line numbers.",
    },
    context: {
      type: "number",
      description: "With pattern: include ±N surrounding lines per match (grep -C). Default 0.",
    },
  },
  required: ["id"],
};

function validateOutputInput(
  params: unknown,
): { valid: true } | { valid: false; error: string } {
  if (!params || typeof params !== "object") {
    return { valid: false, error: "Expected object parameters" };
  }
  const p = params as Record<string, unknown>;
  if (typeof p.id !== "string" || p.id.length === 0) {
    return { valid: false, error: "id is required and must be a string" };
  }
  if (p.offset !== undefined && coerceNumber(p.offset) === undefined) {
    return { valid: false, error: "offset must be a number" };
  }
  if (p.limit !== undefined && coerceNumber(p.limit) === undefined) {
    return { valid: false, error: "limit must be a number" };
  }
  if (p.context !== undefined && coerceNumber(p.context) === undefined) {
    return { valid: false, error: "context must be a number" };
  }
  return { valid: true };
}

async function executeOutput(
  params: OutputParams,
  ctx: ToolContext,
): Promise<
  ToolExecutionResult<{ title: string; output: string; metadata?: Record<string, unknown> }>
> {
  const id = params.id;
  // No session ⇒ no store. Same degradation as a miss (spec D4).
  const store = ctx.sessionId ? getOutputStore(ctx.sessionId) : undefined;
  if (!store || !store.has(id)) {
    return {
      success: true,
      result: {
        title: `output ${id}`,
        output: `No cached output for id "${id}" — it was never stored, evicted, or the session restarted. Re-run the original tool to regenerate it.`,
        metadata: { found: false },
      },
    };
  }

  const pattern = typeof params.pattern === "string" ? params.pattern : undefined;
  const res = pattern
    ? store.grep(id, pattern, coerceNumber(params.context) ?? 0)
    : store.slice(
        id,
        coerceNumber(params.offset) ?? 1,
        coerceNumber(params.limit) ?? DEFAULT_LINES,
      );

  // Cap our OWN result so paging a huge slice can't re-overflow the context.
  const { modelOutput, truncated } = adaptiveTruncate(res.text, id);
  const summary = pattern
    ? `(grep "${pattern}" over ${res.totalLines} lines)`
    : `(lines from a ${res.totalLines}-line output)`;

  return {
    success: true,
    result: {
      title: `output ${id}`,
      output: `${modelOutput}\n\n${summary}`,
      metadata: { found: true, totalLines: res.totalLines, truncated },
    },
  };
}

export const OutputTool: Tool<OutputParams> = buildTool({
  id: "output",
  description:
    "Read the full output of an earlier tool call by its id (offset/limit or pattern) instead of re-running it",
  schemas: {
    parameters: outputSchema,
  },
  permissions: {
    operations: ["file.read"],
  },
  behavior: {
    isConcurrencySafe: true,
    isDestructive: false,
    userFacingName: "Output",
  },
  ui: {
    ...defaultToolUI,
    ...outputToolUI,
  },
  execute: executeOutput,
  validateInput: validateOutputInput,
  isSearchOrReadCommand: () => ({ isSearch: false, isRead: true }),
});
