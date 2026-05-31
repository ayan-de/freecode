// =============================================================================
// Glob Tool - File pattern matching with UI rendering
// =============================================================================

import * as fs from "fs"
import * as path from "path"
import fg from "fast-glob"
import type { ToolContext } from "./types"
import type { Tool, ToolExecutionResult, JsonSchema } from "./tool.types"
import { buildTool, defaultToolUI } from "./factory"
import { globToolUI } from "./glob/ui"

interface GlobParams {
  pattern: string
  path?: string
  cwd?: string
}

// =============================================================================
// Glob Schema
// =============================================================================

const globSchema: JsonSchema = {
  type: "object",
  properties: {
    pattern: { description: "Glob pattern to match (e.g. '**/*.ts', 'src/**/*.js')" },
    path: { description: "Directory to search in (defaults to cwd)" },
    cwd: { description: "Current working directory" },
  },
  required: ["pattern"],
}

// =============================================================================
// Input validation
// =============================================================================

function validateGlobInput(params: unknown): { valid: true } | { valid: false; error: string } {
  if (!params || typeof params !== "object") {
    return { valid: false, error: "Expected object parameters" }
  }
  const p = params as Record<string, unknown>
  if (typeof p.pattern !== "string" || p.pattern.length === 0) {
    return { valid: false, error: "pattern is required and must be a string" }
  }
  return { valid: true }
}

// =============================================================================
// patternsFromGlob
// =============================================================================

function patternsFromGlob(pattern: string): string[] {
  if (pattern.includes("**")) {
    return [pattern]
  }
  if (/[*?[\]]/.test(pattern)) {
    return [pattern]
  }
  return [`${pattern}/**`, pattern]
}

// =============================================================================
// Execute function
// =============================================================================

async function executeGlob(
  params: GlobParams,
  ctx: ToolContext
): Promise<ToolExecutionResult<{ title: string; output: string; metadata?: Record<string, unknown> }>> {
  try {
    const cwd = params.cwd ?? params.path ?? ctx.cwd
    const resolvedCwd = path.isAbsolute(cwd) ? cwd : path.resolve(process.cwd(), cwd)

    if (!fs.existsSync(resolvedCwd)) {
      return {
        success: false,
        error: `Directory not found: ${resolvedCwd}`,
      }
    }

    const pattern = path.isAbsolute(params.pattern)
      ? params.pattern
      : path.join(resolvedCwd, params.pattern)

    const entries = await fg.async(patternsFromGlob(pattern), {
      cwd: resolvedCwd,
      onlyFiles: true,
      onlyDirectories: false,
      ignore: ["**/node_modules/**", "**/.git/**"],
    })

    if (entries.length === 0) {
      return {
        success: true,
        result: {
          title: "glob",
          output: "No files found matching pattern",
          metadata: { count: 0 },
        },
      }
    }

    const formatted = entries.map((e) => path.resolve(resolvedCwd, e)).join("\n")
    return {
      success: true,
      result: {
        title: "glob",
        output: formatted,
        metadata: { count: entries.length },
      },
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

// =============================================================================
// GlobTool - Built with buildTool() factory
// =============================================================================

export const GlobTool: Tool<GlobParams> = buildTool({
  id: "glob",
  description: "Find files matching glob patterns",
  schemas: {
    parameters: globSchema,
  },
  permissions: {
    operations: ["file.read"],
  },
  behavior: {
    isConcurrencySafe: true,
    isDestructive: false,
    userFacingName: "Glob",
  },
  ui: {
    ...defaultToolUI,
    ...globToolUI,
  },
  execute: executeGlob,
  validateInput: validateGlobInput,
  isSearchOrReadCommand: () => ({ isSearch: true, isRead: false }),
})
