// =============================================================================
// grep Tool - Content search via ripgrep
// PRIMARY: Search file contents with regex patterns
// INPUT: { pattern: string, path?: string, include?: string, ... }
// OUTPUT: Matched lines with file:line:content format
// NOTE: Uses system ripgrep binary (rg)
// =============================================================================

import { spawn } from "child_process"
import * as path from "path"
import type { ToolDef, ToolContext, ToolResult } from "./types"

export interface GrepParams {
  pattern: string
  path?: string
  include?: string    // File pattern filter (e.g. "*.ts")
  glob?: string       // Glob pattern to include
  "-n"?: boolean      // Show line numbers
  "-i"?: boolean      // Case insensitive
  "-C"?: number       // Context lines before/after
  "-B"?: number       // Context lines before
  "-A"?: number       // Context lines after
  output_mode?: "content" | "files_with_matches" | "count"
  head_limit?: number
  type?: string       // File type filter
  cwd?: string
}

export const GrepTool: ToolDef<GrepParams> = {
  id: "grep",
  description: "Search file contents using regex patterns",
  parameters: {
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
        description: "Output format: content, files_with_matches, or count"
      },
      head_limit: { description: "Maximum number of matches to return" },
      type: { description: "Filter by file type (e.g. 'ts', 'js')" },
      cwd: { description: "Current working directory" },
    },
    required: ["pattern"],
  },
  execute: async (params: GrepParams, ctx: ToolContext): Promise<ToolResult> => {
    const cwd = params.cwd ?? params.path ?? ctx.cwd
    const searchPath = path.isAbsolute(cwd) ? cwd : path.resolve(process.cwd(), cwd)

    const args: string[] = []

    // Output format
    const mode = params.output_mode ?? "content"
    if (mode === "files_with_matches") {
      args.push("--files-with-matches")
    } else if (mode === "count") {
      args.push("--count")
    } else {
      args.push("--line-number")
    }

    // Search options
    if (params["-i"]) args.push("--case-insensitive")
    if (params["-n"]) args.push("--line-number")
    if (params["-C"]) args.push(`--context=${params["-C"]}`)
    if (params["-B"]) args.push(`--before-context=${params["-B"]}`)
    if (params["-A"]) args.push(`--after-context=${params["-A"]}`)

    // File filters
    if (params.include) args.push("--glob", params.include)
    if (params.glob) args.push("--glob", params.glob)
    if (params.type) args.push("--type", params.type)

    // Limit
    if (params.head_limit) {
      args.push(`--max-count=${params.head_limit}`)
    }

    // Pattern and path
    args.push(params.pattern)
    if (mode === "content" || mode === "count") {
      args.push(searchPath)
    }

    const result = await runRipgrep(args)

    if (result.exitCode !== 0) {
      return {
        title: params.pattern,
        output: result.stderr || "No matches found",
        metadata: { matches: 0 },
      }
    }

    return {
      title: params.pattern,
      output: result.stdout || "No matches found",
      metadata: {
        matches: countMatches(result.stdout, mode),
        exitCode: result.exitCode,
      },
    }
  },
}

function countMatches(output: string, mode: string): number {
  if (mode === "files_with_matches") {
    return output.split("\n").filter(Boolean).length
  }
  if (mode === "count") {
    return output.split("\n").filter(Boolean).length
  }
  // content mode - count lines starting with filename
  return output.split("\n").filter((l) => l.includes(":")).length
}

function runRipgrep(args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    const rg = spawn("rg", args)
    let stdout = ""
    let stderr = ""

    rg.stdout.on("data", (data) => {
      stdout += data.toString()
    })

    rg.stderr.on("data", (data) => {
      stderr += data.toString()
    })

    rg.on("close", (code) => {
      resolve({
        stdout,
        stderr,
        exitCode: code ?? 0,
      })
    })

    rg.on("error", (err) => {
      resolve({
        stdout: "",
        stderr: err.message,
        exitCode: 1,
      })
    })
  })
}
