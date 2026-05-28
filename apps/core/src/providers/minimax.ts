import { AIProvider, ExecuteOptions, ExecuteResult } from './types'
import { getApiKey, ProviderId } from './config'
import { registerProvider } from './registry'

const PROVIDER_INFO = {
  id: "minimax" as const,
  name: "MiniMax",
  defaultModel: "MiniMax-M2",
  supportsStreaming: false,
  supportsTools: true,
}

const BASE_URL = "https://api.minimax.io/anthropic/v1/messages"

function createMiniMaxProvider(_apiKey: string): AIProvider {
  async function execute(opts: ExecuteOptions): Promise<ExecuteResult> {
    const model = opts.model || PROVIDER_INFO.defaultModel
    const apiKey = getApiKey("minimax" as ProviderId)

    const messages: Array<{ role: "user" | "assistant"; content: string }> = []
    if (opts.system) {
      messages.push({ role: "user", content: opts.system })
    }
    messages.push({ role: "user", content: opts.prompt })

    const body: Record<string, unknown> = {
      model,
      max_tokens: opts.maxTokens || 4096,
      messages,
    }
    if (opts.temperature !== undefined) body.temperature = opts.temperature

    const response = await fetch(BASE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`MiniMax API error ${response.status}: ${errorText}`)
    }

    const data = await response.json() as {
      content: Array<{ type: string; text?: string; thinking?: string }>
      usage: { input_tokens: number; output_tokens: number }
      stop_reason: string
    }

    // Extract text content, filter out thinking blocks
    const textParts = data.content?.filter(c => c.type === "text" || c.type === "thinking")
    const content = textParts?.map(c => c.text || c.thinking || "").join("\n").trim() || ""

    let stopReason: ExecuteResult["stopReason"] = "unknown"
    if (data.stop_reason === "end_turn" || data.stop_reason === "stop") stopReason = "stop"
    else if (data.stop_reason === "max_tokens") stopReason = "max_tokens"

    return {
      content,
      usage: data.usage ? {
        inputTokens: data.usage.input_tokens,
        outputTokens: data.usage.output_tokens,
      } : undefined,
      stopReason,
      provider: PROVIDER_INFO.id,
      model,
    }
  }

  return { info: PROVIDER_INFO, execute }
}

registerProvider("minimax" as ProviderId, {
  info: PROVIDER_INFO,
  create: createMiniMaxProvider,
})