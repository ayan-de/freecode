import * as fs from "fs"
import * as path from "path"
import type { ToolDef, ToolContext, ToolResult } from "./types"

interface ReadParams {
  filePath: string
  offset?: number
  limit?: number
}

const DEFAULT_LIMIT = 2000
const MAX_LINE_LENGTH = 2000
const MAX_BYTES = 50 * 1024
const MAX_BYTES_LABEL = `${MAX_BYTES / 1024} KB`

function isBinaryFile(bytes: Uint8Array): boolean {
  if (bytes.length === 0) return false
  let nonPrintableCount = 0
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] === 0) return true
    if (bytes[i] < 9 || (bytes[i] > 13 && bytes[i] < 32)) {
      nonPrintableCount++
    }
  }
  return nonPrintableCount / bytes.length > 0.3
}

function readLines(
  filepath: string,
  opts: { limit: number; offset: number },
): { raw: string[]; count: number; cut: boolean; more: boolean } {
  const content = fs.readFileSync(filepath, "utf-8")
  const allLines = content.split("\n")
  const start = opts.offset - 1
  const raw = allLines.slice(start, start + opts.limit)
  const count = allLines.length
  const more = start + opts.limit < count
  const cut = raw.join("\n").length > MAX_BYTES || raw.length >= opts.limit

  return { raw, count, cut, more }
}

export const ReadTool: ToolDef<ReadParams> = {
  id: "read",
  description: "Read file contents",
  parameters: {
    type: "object",
    properties: {
      filePath: { description: "The absolute path to the file or directory to read" },
      offset: { description: "The line number to start reading from (1-indexed)" },
      limit: { description: "The maximum number of lines to read (defaults to 2000)" },
    },
    required: ["filePath"],
  },
  execute: async (params: ReadParams, ctx: ToolContext): Promise<ToolResult> => {
    let filepath = params.filePath
    if (!path.isAbsolute(filepath)) {
      filepath = path.resolve(ctx.cwd, filepath)
    }

    const stat = fs.statSync(filepath)

    if (stat.isDirectory()) {
      const items = fs.readdirSync(filepath).sort()
      const offset = params.offset || 1
      const limit = params.limit ?? DEFAULT_LIMIT
      const start = offset - 1
      const sliced = items.slice(start, start + limit)
      const truncated = start + sliced.length < items.length

      return {
        title: path.basename(filepath),
        output: [
          `<path>${filepath}</path>`,
          `<type>directory</type>`,
          `<entries>`,
          sliced.join("\n"),
          truncated
            ? `\n(Showing ${sliced.length} of ${items.length} entries)`
            : `\n(${items.length} entries)`,
          `</entries>`,
        ].join("\n"),
        metadata: { truncated },
      }
    }

    const sample = fs.readFileSync(filepath)
    if (isBinaryFile(sample)) {
      return { title: path.basename(filepath), output: `Cannot read binary file: ${filepath}` }
    }

    const lines = readLines(filepath, {
      limit: params.limit ?? DEFAULT_LIMIT,
      offset: params.offset || 1,
    })

    let output = [`<path>${filepath}</path>`, `<type>file</type>`, "<content>\n"].join("\n")
    output += lines.raw.map((line, i) => `${i + (params.offset || 1)}: ${line}`).join("\n")

    const last = (params.offset || 1) + lines.raw.length - 1
    const next = last + 1

    if (lines.cut) {
      output += `\n\n(Output capped at ${MAX_BYTES_LABEL}. Showing lines ${params.offset || 1}-${last}. Use offset=${next} to continue.)`
    } else if (lines.more) {
      output += `\n\n(Showing lines ${params.offset || 1}-${last} of ${lines.count}. Use offset=${next} to continue.)`
    } else {
      output += `\n\n(End of file - total ${lines.count} lines)`
    }
    output += "\n</content>"

    return {
      title: path.basename(filepath),
      output,
      metadata: { truncated: lines.cut || lines.more, lines: lines.count },
    }
  },
}