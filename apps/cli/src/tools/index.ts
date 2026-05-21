import { ReadTool } from "./read"
import { WriteTool } from "./write"
import type { ToolDef } from "./types"

export type { ToolContext, ToolResult, JsonSchema } from "./types"
export type { ToolDef }

export const tools = {
  read: ReadTool,
  write: WriteTool,
} as const

export type ToolId = keyof typeof tools

export function getTool(id: ToolId): ToolDef | undefined {
  return tools[id] as ToolDef | undefined
}

export function listTools(): { id: string; description: string }[] {
  return Object.values(tools).map((t) => ({ id: t.id, description: t.description }))
}