import { getTool, listTools, tools } from "./tools/index.js"
import type { ToolContext } from "./tools/types.js"

type JsonRpcRequest = {
  jsonrpc: "2.0"
  id: number | string
  method: string
  params?: Record<string, unknown>
}

type JsonRpcResponse = {
  jsonrpc: "2.0"
  id: number | string
  result?: unknown
  error?: { code: number; message: string; data?: unknown }
}

function createResponse(id: number | string, result: unknown): JsonRpcResponse {
  return { jsonrpc: "2.0", id, result }
}

function createError(id: number | string, code: number, message: string, data?: unknown): JsonRpcResponse {
  return { jsonrpc: "2.0", id, error: { code, message, data } }
}

const methodHandlers: Record<string, (params: Record<string, unknown>) => Promise<unknown>> = {
  "tools.list": async () => listTools(),

  "tools.call": async (params: Record<string, unknown>) => {
    const { name, args } = params as { name: string; args: Record<string, unknown> }
    const tool = getTool(name as any)
    if (!tool) {
      throw new Error(`Tool not found: ${name}`)
    }
    const ctx: ToolContext = { cwd: process.cwd() }
    return tool.execute(args, ctx)
  },
}

async function handleRequest(request: JsonRpcRequest): Promise<JsonRpcResponse> {
  try {
    const handler = methodHandlers[request.method]
    if (!handler) {
      return createError(request.id, -32601, `Method not found: ${request.method}`)
    }
    const result = await handler(request.params ?? {})
    return createResponse(request.id, result)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return createError(request.id, -32603, message)
  }
}

async function main() {
  let buffer = ""

  process.stdin.setEncoding("utf-8")

  process.stdin.on("data", async (chunk: string) => {
    buffer += chunk

    const lines = buffer.split("\n")
    buffer = lines.pop() ?? ""

    for (const line of lines) {
      if (!line.trim()) continue
      try {
        const request = JSON.parse(line) as JsonRpcRequest
        const response = await handleRequest(request)
        process.stdout.write(JSON.stringify(response) + "\n")
      } catch (e) {
        const error = e instanceof Error ? e.message : String(e)
        process.stderr.write(`Parse error: ${error}\n`)
      }
    }
  })

  process.stdin.on("end", () => {
    if (buffer.trim()) {
      try {
        const request = JSON.parse(buffer) as JsonRpcRequest
        const response = handleRequest(request).then((r) => {
          process.stdout.write(JSON.stringify(r) + "\n")
        })
      } catch (e) {
        process.stderr.write(`Final parse error: ${e}\n`)
      }
    }
  })
}

main().catch((e) => {
  process.stderr.write(`Server error: ${e}\n`)
  process.exit(1)
})