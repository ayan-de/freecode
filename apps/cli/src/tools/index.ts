import { ReadTool } from "./read"
import { WriteTool } from "./write"
import { GlobTool } from "./glob"
import { GrepTool } from "./grep"
import { EditTool } from "./edit"
import { createToolOrchestrator, type ToolOrchestrator } from "./orchestrator"
import type { ToolDef } from "./types"

export type { ToolContext, ToolResult, JsonSchema } from "./types"
export type { ToolDef }
export type { ToolOrchestrator }

export const tools = {
  read: ReadTool,
  write: WriteTool,
  glob: GlobTool,
  grep: GrepTool,
  edit: EditTool,
} as const

export type ToolId = keyof typeof tools

export function getTool(id: string): ToolDef | undefined {
  return tools[id as ToolId] as ToolDef | undefined
}

export function listTools(): { id: string; description: string }[] {
  return Object.values(tools).map((t) => ({ id: t.id, description: t.description }))
}

export { createToolOrchestrator }