import type { Message } from '../agent/types.js'

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

export interface SystemBlock {
  text: string
  cache?: boolean
}

export interface ExecuteOptions {
  prompt?: string
  messages?: Message[]
  system?: string | SystemBlock[]
  model?: string
  temperature?: number
  maxTokens?: number
  tools?: ToolDef[]
  toolResults?: Array<{ toolCallId: string; result: string; name?: string; input?: Record<string, unknown> }>
  stream?: boolean
}

export interface ExecuteResult {
  content: string
  thinking?: string  // Extended thinking/reasoning content
  toolCalls?: Array<{ name: string; args: Record<string, unknown>; id: string }>
  usage?: {
    inputTokens: number
    outputTokens: number
    cacheCreationInputTokens?: number
    cacheReadInputTokens?: number
  }
  stopReason: "stop" | "tool_use" | "max_tokens" | "unknown"
  provider: string
  model: string
}

export interface AIProvider {
  info: ProviderInfo
  execute(opts: ExecuteOptions): Promise<ExecuteResult>
}
