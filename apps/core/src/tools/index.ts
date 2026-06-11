import { ReadTool } from "./read.js"
import { WriteTool } from "./write.js"
import { GlobTool } from "./glob.js"
import { GrepTool } from "./grep.js"
import { EditTool } from "./edit.js"
import { BashTool } from "./bash.js"
import { SkillTool } from "./skill.js"
import { AgentTool } from "./agent.js"
import { QuestionTool } from "./question.js"
import { createToolOrchestrator, type ToolOrchestrator } from "./orchestrator.js"
import type { ToolContext, ToolResult, JsonSchema, FileCache, FileCacheEntry, PermissionProfile } from "./types.js"
import type { Tool, ToolUseMessage, ToolUI, ToolBehavior, ToolPermissions, ToolExecutionResult, ValidationResult, PermissionCheckResult } from "./tool.types.js"
import { buildTool, defaultToolUI, defaultBehavior, executeTool } from "./factory.js"
import { createToolRenderer, type ToolRenderer, formatToolUseMessage, formatToolUseTag } from "./renderer.js"

export type { ToolContext, ToolResult, JsonSchema, FileCache, FileCacheEntry, PermissionProfile }
export type { Tool, ToolUseMessage, ToolUI, ToolBehavior, ToolPermissions, ToolExecutionResult, ValidationResult, PermissionCheckResult }
export type { ToolOrchestrator }
export type { ToolRenderer }

const mcpTools: Record<string, Tool> = {};

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

export function registerMcpTool(tool: Tool): void {
  mcpTools[tool.id] = tool;
}

export function unregisterMcpTools(prefix: string): void {
  for (const key of Object.keys(mcpTools)) {
    if (key.startsWith(prefix)) {
      delete mcpTools[key];
    }
  }
}

export function getMcpTools(): Record<string, Tool> {
  return { ...mcpTools };
}

export function getTool(id: string): Tool | undefined {
  if (tools[id as ToolId]) return tools[id as ToolId] as Tool;
  return mcpTools[id];
}

export function listTools(): { id: string; description: string; parameters: JsonSchema }[] {
  const builtIn = Object.values(tools).map((t) => ({
    id: t.id,
    description: t.description,
    parameters: t.schemas.parameters,
  }));

  const mcp = Object.values(mcpTools).map((t) => ({
    id: t.id,
    description: t.description,
    parameters: t.schemas.parameters,
  }));

  return [...builtIn, ...mcp];
}

export { createToolOrchestrator }
export { buildTool, defaultToolUI, defaultBehavior, executeTool }
export { createToolRenderer, formatToolUseMessage, formatToolUseTag }
