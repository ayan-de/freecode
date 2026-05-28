export interface ProviderInfo {
  id: string
  name: string
  defaultModel: string
  supportsStreaming: boolean
  supportsTools: boolean
}

export interface ToolDef {
  name: string
  description: string
  parameters: Record<string, unknown>
}

export interface ExecuteOptions {
  prompt: string
  system?: string
  model?: string
  temperature?: number
  maxTokens?: number
  tools?: ToolDef[]
  toolResults?: Array<{ toolCallId: string; result: string; name?: string; input?: Record<string, unknown> }>
  stream?: boolean
}

export interface ExecuteResult {
  content: string
  toolCalls?: Array<{ name: string; args: Record<string, unknown>; id: string }>
  usage?: { inputTokens: number; outputTokens: number }
  stopReason: "stop" | "tool_use" | "max_tokens" | "unknown"
  provider: string
  model: string
}

export interface AIProvider {
  info: ProviderInfo
  execute(opts: ExecuteOptions): Promise<ExecuteResult>
}
