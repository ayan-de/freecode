import { ReadTool } from "./read.js";
import { WriteTool } from "./write.js";
import { GlobTool } from "./glob.js";
import { GrepTool } from "./grep.js";
import { EditTool } from "./edit.js";
import { BashTool } from "./bash.js";
import { SkillTool } from "./skill.js";
import { AgentTool } from "./agent.js";
import { QuestionTool } from "./question.js";
import { WebFetchTool } from "./webfetch.js";
import { WebSearchTool } from "./websearch.js";
import { TodoWriteTool } from "./todo.js";
import { LspTool } from "./lsp.js";
import { LsTool } from "./ls.js";
import { OutputTool } from "./output.js";
import { MemoryTool } from "./memory.js";
import {
  createToolOrchestrator,
  type ToolOrchestrator,
} from "./orchestrator.js";
import type {
  ToolContext,
  ToolResult,
  JsonSchema,
  FileCache,
  FileCacheEntry,
  PermissionProfile,
} from "./types.js";
import type {
  Tool,
  ToolBehavior,
  ToolPermissions,
  ToolExecutionResult,
  ValidationResult,
  PermissionCheckResult,
} from "./tool.types.js";
import {
  buildTool,
  defaultBehavior,
  executeTool,
} from "./factory.js";

export type {
  ToolContext,
  ToolResult,
  JsonSchema,
  FileCache,
  FileCacheEntry,
  PermissionProfile,
};
export type {
  Tool,
  ToolBehavior,
  ToolPermissions,
  ToolExecutionResult,
  ValidationResult,
  PermissionCheckResult,
};
export type { ToolOrchestrator };

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
  webfetch: WebFetchTool,
  websearch: WebSearchTool,
  todowrite: TodoWriteTool,
  lsp: LspTool,
  ls: LsTool,
  output: OutputTool,
  memory: MemoryTool,
} as const;

export type ToolId = keyof typeof tools;

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

export function listTools(): {
  id: string;
  description: string;
  parameters: JsonSchema;
}[] {
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

export { createToolOrchestrator };
export { buildTool, defaultBehavior, executeTool };
