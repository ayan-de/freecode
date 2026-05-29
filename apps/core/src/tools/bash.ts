// =============================================================================
// bash Tool - Shell command execution
// PRIMARY: Execute shell commands and return output
// INPUT: { command: string, timeout?: number, workdir?: string }
// OUTPUT: Command output with exit code
// =============================================================================

import { spawn } from "child_process"
import * as path from "path"
import type { ToolDef, ToolContext, ToolResult } from "./types"

export interface BashParams {
  command: string
  timeout?: number       // Timeout in milliseconds (default: 60000)
  workdir?: string      // Working directory (defaults to ctx.cwd)
}

const DEFAULT_TIMEOUT = 60_000
const MAX_OUTPUT_BYTES = 500_000

function truncateOutput(output: string, maxBytes: number = MAX_OUTPUT_BYTES): { text: string; truncated: boolean } {
  const bytes = Buffer.byteLength(output, "utf-8")
  if (bytes <= maxBytes) {
    return { text: output, truncated: false }
  }

  // Truncate from the end, preserving complete lines
  const lines = output.split("\n")
  const truncated: string[] = []
  let byteCount = 0

  for (let i = lines.length - 1; i >= 0; i--) {
    const lineBytes = Buffer.byteLength(lines[i], "utf-8") + 1 // +1 for newline
    if (byteCount + lineBytes > maxBytes) {
      // If this is the first line we're adding and it would exceed, just add what fits
      if (truncated.length === 0) {
        const buf = Buffer.from(lines[i], "utf-8")
        const available = maxBytes - byteCount - 5 // 5 for "...\n"
        if (available > 0) {
          truncated.unshift("..." + buf.subarray(buf.length - available).toString("utf-8"))
        }
      }
      break
    }
    truncated.unshift(lines[i])
    byteCount += lineBytes
  }

  return { text: truncated.join("\n") + "\n[output truncated]", truncated: true }
}

export const BashTool: ToolDef<BashParams> = {
  id: "bash",
  description: "Execute shell commands",
  parameters: {
    type: "object",
    properties: {
      command: { description: "The shell command to execute" },
      timeout: { description: "Timeout in milliseconds (default: 60000)" },
      workdir: { description: "Working directory for the command" },
    },
    required: ["command"],
  },
  execute: async (params: BashParams, ctx: ToolContext): Promise<ToolResult> => {
    const cwd = params.workdir
      ? path.isAbsolute(params.workdir)
        ? params.workdir
        : path.resolve(ctx.cwd, params.workdir)
      : ctx.cwd

    const timeout = params.timeout ?? DEFAULT_TIMEOUT

    return new Promise((resolve) => {
      const isWindows = process.platform === "win32"
      const shell = isWindows ? "cmd.exe" : "/bin/bash"
      const shellArgs = isWindows ? ["/c", params.command] : ["-c", params.command]

      const child = spawn(shell, shellArgs, {
        cwd,
        env: { ...process.env },
        stdio: "pipe",
      })

      let stdout = ""
      let stderr = ""
      let killed = false

      // Handle timeout
      const timer = setTimeout(() => {
        killed = true
        child.kill("SIGTERM")
        // Force kill after 3 seconds on Windows or if SIGTERM doesn't work
        setTimeout(() => {
          if (!child.killed) {
            child.kill("SIGKILL")
          }
        }, 3000)
      }, timeout)

      child.stdout?.on("data", (data) => {
        stdout += data.toString()
      })

      child.stderr?.on("data", (data) => {
        stderr += data.toString()
      })

      child.on("close", (code) => {
        clearTimeout(timer)

        let output = ""
        if (stdout) output += stdout
        if (stderr) output += (output ? "\n" : "") + "<stderr>\n" + stderr + "\n</stderr>"

        if (!output) {
          output = "(no output)"
        }

        const truncated = truncateOutput(output)

        const result: ToolResult = {
          title: params.command.split("\n")[0].slice(0, 50), // First line, truncated
          output: truncated.text,
          metadata: {
            exitCode: code,
            truncated: truncated.truncated,
            command: params.command,
            cwd,
          },
        }

        if (killed) {
          result.output += `\n\n<bash_metadata>\nCommand timed out after ${timeout}ms\n</bash_metadata>`
        }

        resolve(result)
      })

      child.on("error", (err) => {
        clearTimeout(timer)
        resolve({
          title: params.command.split("\n")[0].slice(0, 50),
          output: `Error executing command: ${err.message}`,
          metadata: {
            exitCode: -1,
            error: err.message,
          },
        })
      })
    })
  },
}
