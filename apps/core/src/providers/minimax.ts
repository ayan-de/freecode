import { AIProvider, ExecuteOptions, ExecuteResult } from './types'
import { getApiKey, ProviderId } from './config'
import { registerProvider } from './registry'

const PROVIDER_INFO = {
  id: "minimax" as const,
  name: "MiniMax",
  defaultModel: "MiniMax-text-01",
  supportsStreaming: false,
  supportsTools: false,
}

const BASE_URL = "https://api.minimax.chat/v1"
const CHAT_COMPLETIONS_URL = `${BASE_URL}/chat/completions`

function createMiniMaxProvider(_apiKey: string): AIProvider {
  async function execute(opts: ExecuteOptions): Promise<ExecuteResult> {
    const model = opts.model || PROVIDER_INFO.defaultModel
    const apiKey = getApiKey("minimax" as ProviderId)

    const messages: Array<{ role: string; content: string }> = []
    if (opts.system) {
      messages.push({ role: "system", content: opts.system })
    }
    messages.push({ role: "user", content: opts.prompt })

    const body: Record<string, unknown> = {
      model,
      messages,
    }
    if (opts.temperature !== undefined) body.temperature = opts.temperature
    if (opts.maxTokens) body.max_tokens = opts.maxTokens

    const response = await fetch(CHAT_COMPLETIONS_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`MiniMax API error ${response.status}: ${errorText}`)
    }

    const data = await response.json() as {
      choices: Array<{
        message: { content: string }
        finish_reason: string
      }>
      usage?: { prompt_tokens: number; completion_tokens: number }
    }

    const choice = data.choices[0]
    const content = choice?.message?.content || ""

    let stopReason: ExecuteResult["stopReason"] = "unknown"
    if (choice?.finish_reason === "stop") stopReason = "stop"
    else if (choice?.finish_reason === "length") stopReason = "max_tokens"

    return {
      content,
      usage: data.usage ? {
        inputTokens: data.usage.prompt_tokens,
        outputTokens: data.usage.completion_tokens,
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
