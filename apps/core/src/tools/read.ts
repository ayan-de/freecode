// =============================================================================
// Read Tool - Read file contents with UI rendering
// =============================================================================

import * as fs from "fs"
import * as path from "path"
import type { ToolContext } from "./types"
import type { Tool, ToolExecutionResult, JsonSchema } from "./tool.types"
import { buildTool, defaultToolUI } from "./factory"
import { readToolUI } from "./read/ui"

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

// =============================================================================
// Read Schema
// =============================================================================

const readSchema: JsonSchema = {
  type: "object",
  properties: {
    filePath: { description: "The absolute path to the file or directory to read" },
    offset: { description: "The line number to start reading from (1-indexed)" },
    limit: { description: "The maximum number of lines to read (defaults to 2000)" },
  },
  required: ["filePath"],
}

// =============================================================================
// Input validation
// =============================================================================

function validateReadInput(params: unknown): { valid: true } | { valid: false; error: string } {
  if (!params || typeof params !== "object") {
    return { valid: false, error: "Expected object parameters" }
  }
  const p = params as Record<string, unknown>
  if (typeof p.filePath !== "string" || p.filePath.length === 0) {
    return { valid: false, error: "filePath is required and must be a string" }
  }
  if (p.offset !== undefined && typeof p.offset !== "number") {
    return { valid: false, error: "offset must be a number" }
  }
  if (p.limit !== undefined && typeof p.limit !== "number") {
    return { valid: false, error: "limit must be a number" }
  }
  return { valid: true }
}

// =============================================================================
// Execute function
// =============================================================================

async function executeRead(
  params: ReadParams,
  ctx: ToolContext
): Promise<ToolExecutionResult<{ title: string; output: string; metadata?: Record<string, unknown> }>> {
  try {
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
        success: true,
        result: {
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
        },
      }
    }

    const sample = fs.readFileSync(filepath)
    if (isBinaryFile(sample)) {
      return {
        success: false,
        error: `Cannot read binary file: ${filepath}`,
      }
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
      success: true,
      result: {
        title: path.basename(filepath),
        output,
        metadata: { truncated: lines.cut || lines.more, lines: lines.count },
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
// ReadTool - Built with buildTool() factory
// =============================================================================

export const ReadTool: Tool<ReadParams> = buildTool({
  id: "read",
  description: "Read file contents",
  schemas: {
    parameters: readSchema,
  },
  permissions: {
    operations: ["file.read"],
  },
  behavior: {
    isConcurrencySafe: true,
    isDestructive: false,
    userFacingName: "Read File",
  },
  ui: {
    ...defaultToolUI,
    ...readToolUI,
  },
  execute: executeRead,
  validateInput: validateReadInput,
  isSearchOrReadCommand: () => ({ isSearch: false, isRead: true }),
  getPath: (params) => params.filePath,
})
