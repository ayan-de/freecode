// =============================================================================
// Grep Tool - Content search via ripgrep with UI rendering
// =============================================================================

import { spawn } from "child_process";
import * as path from "path";
import type { ToolContext } from "./types";
import type { Tool, ToolExecutionResult, JsonSchema } from "./tool.types";
import { buildTool, defaultToolUI } from "./factory";
import { grepToolUI } from "./grep/ui";

interface GrepParams {
  pattern: string;
  path?: string;
  include?: string;
  glob?: string;
  "-n"?: boolean;
  "-i"?: boolean;
  "-C"?: number;
  "-B"?: number;
  "-A"?: number;
  output_mode?: "content" | "files_with_matches" | "count";
  head_limit?: number;
  type?: string;
  cwd?: string;
}

// =============================================================================
// Grep Schema
// =============================================================================

const grepSchema: JsonSchema = {
  type: "object",
  properties: {
    pattern: { description: "Regular expression pattern to search for" },
    path: { description: "Directory to search in (defaults to cwd)" },
    include: { description: 'File pattern filter (e.g. "*.ts", "*.{ts,tsx}")' },
    glob: { description: "Glob pattern to include/exclude" },
    "-n": { description: "Show line numbers in output" },
    "-i": { description: "Case insensitive search" },
    "-C": { description: "Show N lines of context before and after matches" },
    "-B": { description: "Show N lines of context before matches" },
    "-A": { description: "Show N lines of context after matches" },
    output_mode: {
      description: "Output format: content, files_with_matches, or count",
      enum: ["content", "files_with_matches", "count"],
    },
    head_limit: { description: "Maximum number of matches to return" },
    type: { description: "Filter by file type (e.g. 'ts', 'js')" },
    cwd: { description: "Current working directory" },
  },
  required: ["pattern"],
};

// =============================================================================
// Input validation
// =============================================================================

function validateGrepInput(
  params: unknown,
): { valid: true } | { valid: false; error: string } {
  if (!params || typeof params !== "object") {
    return { valid: false, error: "Expected object parameters" };
  }
  const p = params as Record<string, unknown>;
  if (typeof p.pattern !== "string" || p.pattern.length === 0) {
    return { valid: false, error: "pattern is required and must be a string" };
  }
  return { valid: true };
}

// =============================================================================
// countMatches
// =============================================================================

function countMatches(output: string, mode: string): number {
  if (mode === "files_with_matches") {
    return output.split("\n").filter(Boolean).length;
  }
  if (mode === "count") {
    return output.split("\n").filter(Boolean).length;
  }
  return output.split("\n").filter((l) => l.includes(":")).length;
}

// =============================================================================
// runRipgrep
// =============================================================================

function runRipgrep(
  args: string[],
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    const rg = spawn("rg", args);
    let stdout = "";
    let stderr = "";

    rg.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    rg.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    rg.on("close", (code) => {
      resolve({
        stdout,
        stderr,
        exitCode: code ?? 0,
      });
    });

    rg.on("error", (err) => {
      resolve({
        stdout: "",
        stderr: err.message,
        exitCode: 1,
      });
    });
  });
}

// =============================================================================
// Execute function
// =============================================================================

async function executeGrep(
  params: GrepParams,
  ctx: ToolContext,
): Promise<
  ToolExecutionResult<{
    title: string;
    output: string;
    metadata?: Record<string, unknown>;
  }>
> {
  try {
    const cwd = params.cwd ?? params.path ?? ctx.cwd;
    const searchPath = path.isAbsolute(cwd)
      ? cwd
      : path.resolve(process.cwd(), cwd);

    const args: string[] = [];

    const mode = params.output_mode ?? "content";
    if (mode === "files_with_matches") {
      args.push("--files-with-matches");
    } else if (mode === "count") {
      args.push("--count");
    } else {
      args.push("--line-number");
    }

    if (params["-i"]) args.push("--case-insensitive");
    if (params["-n"]) args.push("--line-number");
    if (params["-C"]) args.push(`--context=${params["-C"]}`);
    if (params["-B"]) args.push(`--before-context=${params["-B"]}`);
    if (params["-A"]) args.push(`--after-context=${params["-A"]}`);

    if (params.include) args.push("--glob", params.include);
    if (params.glob) args.push("--glob", params.glob);
    if (params.type) args.push("--type", params.type);

    if (params.head_limit) {
      args.push(`--max-count=${params.head_limit}`);
    }

    args.push(params.pattern);
    if (mode === "content" || mode === "count") {
      args.push(searchPath);
    }

    const result = await runRipgrep(args);

    if (result.exitCode !== 0) {
      return {
        success: true,
        result: {
          title: params.pattern,
          output: result.stderr || "No matches found",
          metadata: { matches: 0 },
        },
      };
    }

    return {
      success: true,
      result: {
        title: params.pattern,
        output: result.stdout || "No matches found",
        metadata: {
          matches: countMatches(result.stdout, mode),
          exitCode: result.exitCode,
        },
      },
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

// =============================================================================
// GrepTool - Built with buildTool() factory
// =============================================================================

export const GrepTool: Tool<GrepParams> = buildTool({
  id: "grep",
  description: "Search file contents using regex patterns",
  schemas: {
    parameters: grepSchema,
  },
  permissions: {
    operations: ["file.read"],
  },
  behavior: {
    isConcurrencySafe: true,
    isDestructive: false,
    userFacingName: "Grep",
  },
  ui: {
    ...defaultToolUI,
    ...grepToolUI,
  },
  execute: executeGrep,
  validateInput: validateGrepInput,
  isSearchOrReadCommand: () => ({ isSearch: true, isRead: false }),
});
