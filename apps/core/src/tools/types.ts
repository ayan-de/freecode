export interface ToolContext {
  cwd: string
  abort?: AbortSignal
}

export interface ToolResult {
  title: string
  output: string
  metadata?: Record<string, unknown>
}

export interface ToolDef<P = unknown, R extends ToolResult = ToolResult> {
  id: string
  description: string
  parameters: JsonSchema
  execute: (params: P, ctx: ToolContext) => Promise<R>
}

export type ToolRegistry = Record<string, ToolDef>

export interface JsonSchemaProperty {
  description?: string
  type?: string
  enum?: string[]
  items?: JsonSchemaProperty | JsonSchemaProperty[]  // For array items
}

export interface JsonSchema {
  type: string
  properties?: Record<string, JsonSchemaProperty>
  required?: string[]
  items?: JsonSchemaProperty | JsonSchemaProperty[]  // For array types
}