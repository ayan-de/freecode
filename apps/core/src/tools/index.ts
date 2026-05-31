import { ReadTool } from "./read"
import { WriteTool } from "./write"
import { GlobTool } from "./glob"
import { GrepTool } from "./grep"
import { EditTool } from "./edit"
import { BashTool } from "./bash"
import { SkillTool } from "./skill"
import { AgentTool } from "./agent"
import { QuestionTool } from "./question"
import { createToolOrchestrator, type ToolOrchestrator } from "./orchestrator"
import type { ToolContext, ToolResult, JsonSchema, FileCache, FileCacheEntry, PermissionProfile } from "./types"
import type { Tool, ToolUseMessage, ToolUI, ToolBehavior, ToolPermissions, ToolExecutionResult, ValidationResult, PermissionCheckResult } from "./tool.types"
import { buildTool, defaultToolUI, defaultBehavior, executeTool } from "./factory"
import { createToolRenderer, type ToolRenderer, formatToolUseMessage, formatToolUseTag } from "./renderer"

export type { ToolContext, ToolResult, JsonSchema, FileCache, FileCacheEntry, PermissionProfile }
export type { Tool, ToolUseMessage, ToolUI, ToolBehavior, ToolPermissions, ToolExecutionResult, ValidationResult, PermissionCheckResult }
export type { ToolOrchestrator }
export type { ToolRenderer }

export const tools = {
  read: ReadTool,
  write: WriteTool,
  glob: GlobTool,
  grep: GrepTool,
  edit: EditTool,
  bash: BashTool,
  skill: SkillTool,
  agent: AgentTool,
  question: QuestionTool,
} as const

export type ToolId = keyof typeof tools

export function getTool(id: string): Tool | undefined {
  return tools[id as ToolId] as Tool | undefined
}

export function listTools(): { id: string; description: string; parameters: JsonSchema }[] {
  return Object.values(tools).map((t) => ({
    id: t.id,
    description: t.description,
    parameters: t.schemas.parameters,
  }))
}

export { createToolOrchestrator }
export { buildTool, defaultToolUI, defaultBehavior, executeTool }
export { createToolRenderer, formatToolUseMessage, formatToolUseTag }
