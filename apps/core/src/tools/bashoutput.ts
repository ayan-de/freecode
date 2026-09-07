// =============================================================================
// BashOutput Tool - drain new output from a background shell.
//
// Each call returns only what has arrived since the last call for that shell,
// so the model can poll a dev server or a long build without re-reading
// megabytes it has already seen. Read-only: safe in every mode.
//
// A miss (unknown id, or a session that restarted) is a plain message, never an
// error — same contract as the `output` tool (spec D4).
// =============================================================================

import type { ToolContext } from "./types.js";
import type { Tool, ToolExecutionResult, JsonSchema } from "./tool.types.js";
import { buildTool } from "./factory.js";
import { peekShellRegistry } from "./shells/index.js";

interface BashOutputParams {
  bash_id: string;
  filter?: string;
}

const bashOutputSchema: JsonSchema = {
  type: "object",
  properties: {
    bash_id: {
      type: "string",
      description:
        "The shell id returned by bash(run_in_background: true), e.g. bash_1.",
    },
    filter: {
      type: "string",
      description:
        "Optional regex (falls back to literal substring) — return only matching lines.",
    },
  },
  required: ["bash_id"],
};

function validateBashOutputInput(
  params: unknown,
): { valid: true } | { valid: false; error: string } {
  if (!params || typeof params !== "object") {
    return { valid: false, error: "Expected object parameters" };
  }
  const p = params as Record<string, unknown>;
  if (typeof p.bash_id !== "string" || p.bash_id.length === 0) {
    return { valid: false, error: "bash_id is required and must be a string" };
  }
  if (p.filter !== undefined && typeof p.filter !== "string") {
    return { valid: false, error: "filter must be a string" };
  }
  return { valid: true };
}

/** Regex if it compiles, literal substring otherwise — a bad pattern from the
 *  model must degrade to a plain search, not fail the call. */
function applyFilter(text: string, filter: string): string {
  let test: (line: string) => boolean;
  try {
    const re = new RegExp(filter);
    test = (line) => re.test(line);
  } catch {
    test = (line) => line.includes(filter);
  }
  return text.split("\n").filter(test).join("\n");
}

async function executeBashOutput(
  params: BashOutputParams,
  ctx: ToolContext,
): Promise<
  ToolExecutionResult<{
    title: string;
    output: string;
    metadata?: Record<string, unknown>;
  }>
> {
  const registry = ctx.sessionId ? peekShellRegistry(ctx.sessionId) : undefined;
  const read = registry?.readForModel(params.bash_id);

  if (!read || !read.found) {
    return {
      success: true,
      result: {
        title: params.bash_id,
        output: `No background shell ${params.bash_id} in this session. Start one with bash(run_in_background: true), or re-run the command in the foreground.`,
        metadata: { shellId: params.bash_id, found: false },
      },
    };
  }

  const summary = registry?.get(params.bash_id);
  let body = params.filter ? applyFilter(read.text, params.filter) : read.text;
  if (!body.trim()) {
    body =
      read.status === "running"
        ? "(no new output since the last read; still running)"
        : "(no new output)";
  }

  const header: string[] = [`<status>${read.status}</status>`];
  if (read.exitCode !== null) {
    header.push(`<exit_code>${read.exitCode}</exit_code>`);
  }
  if (read.droppedChars > 0) {
    header.push(
      `<dropped>${read.droppedChars} characters of older output were discarded before this read (buffer limit)</dropped>`,
    );
  }

  return {
    success: true,
    result: {
      title: summary?.command.split("\n")[0].slice(0, 50) ?? params.bash_id,
      output: `${header.join("\n")}\n${body}`,
      metadata: {
        shellId: params.bash_id,
        status: read.status,
        exitCode: read.exitCode,
        found: true,
      },
    },
  };
}

export const BashOutputTool: Tool<BashOutputParams> = buildTool({
  id: "bashoutput",
  description:
    "Read new output from a background shell started with bash(run_in_background: true). Each call returns only output that has arrived since your last call for that shell, plus its current status and exit code. Poll this instead of blocking a turn on a dev server, watcher, or long build.",
  schemas: {
    parameters: bashOutputSchema,
  },
  permissions: {
    // Reads an in-memory buffer core already holds — no filesystem, no
    // network, no new process. Same shape as todowrite's empty set.
    operations: [],
    requiresApproval: false,
  },
  behavior: {
    isConcurrencySafe: true,
    isDestructive: false,
    interruptBehavior: "await",
    userFacingName: "BashOutput",
  },
  execute: executeBashOutput,
  validateInput: validateBashOutputInput,
  isSearchOrReadCommand: () => ({ isSearch: false, isRead: true }),
});
