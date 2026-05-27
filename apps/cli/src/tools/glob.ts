// =============================================================================
// glob Tool - File pattern matching
// PRIMARY: Find files matching glob patterns
// INPUT: { pattern: string, path?: string }
// OUTPUT: List of matching file paths
// NOTE: opencode uses Ripgrep for this. FreeCode uses fast-glob (simpler)
// =============================================================================

import * as fs from "fs"
import * as path from "path"
import fg from "fast-glob"
import type { ToolDef, ToolContext, ToolResult } from "./types"

export interface GlobParams {
  pattern: string
  path?: string
  cwd?: string
}

export const GlobTool: ToolDef<GlobParams> = {
  id: "glob",
  description: "Find files matching glob patterns",
  parameters: {
    type: "object",
    properties: {
      pattern: { description: "Glob pattern to match (e.g. '**/*.ts', 'src/**/*.js')" },
      path: { description: "Directory to search in (defaults to cwd)" },
      cwd: { description: "Current working directory" },
    },
    required: ["pattern"],
  },
  execute: async (params: GlobParams, ctx: ToolContext): Promise<ToolResult> => {
    const cwd = params.cwd ?? params.path ?? ctx.cwd
    const resolvedCwd = path.isAbsolute(cwd) ? cwd : path.resolve(process.cwd(), cwd)

    // Ensure directory exists
    if (!fs.existsSync(resolvedCwd)) {
      return {
        title: "glob",
        output: `Directory not found: ${resolvedCwd}`,
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
        title: "glob",
        output: "No files found matching pattern",
        metadata: { count: 0 },
      }
    }

    const formatted = entries.map((e) => path.resolve(resolvedCwd, e)).join("\n")
    return {
      title: "glob",
      output: formatted,
      metadata: { count: entries.length },
    }
  },
}

// Simple glob pattern parser to extract base patterns
// Handles: **/*.ts, src/**/*.js, *.json, etc.
function patternsFromGlob(pattern: string): string[] {
  if (pattern.includes("**")) {
    return [pattern]
  }
  // If no ** but has glob chars, return as-is
  if (/[*?[\]]/.test(pattern)) {
    return [pattern]
  }
  // Literal path - return with ** suffix
  return [`${pattern}/**`, pattern]
}
