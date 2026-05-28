import { createGoogle } from '@ai-sdk/google'
import { generateText } from 'ai'
import { AIProvider, ExecuteOptions, ExecuteResult } from './types'
import { getApiKey, ProviderId } from './config'
import { registerProvider } from './registry'

const PROVIDER_INFO = {
  id: "gemini" as const,
  name: "Google Gemini",
  defaultModel: "gemini-2.0-flash",
  supportsStreaming: true,
  supportsTools: true,
}

function createGeminiProvider(_apiKey: string): AIProvider {
  const google = createGoogle({ apiKey: getApiKey("gemini" as ProviderId) })

  async function execute(opts: ExecuteOptions): Promise<ExecuteResult> {
    const model = opts.model || PROVIDER_INFO.defaultModel

    const tools = opts.tools?.map(tool => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    })) || []

    const result = await generateText({
      model: google(model),
      system: opts.system,
      prompt: opts.prompt,
      temperature: opts.temperature,
      maxTokens: opts.maxTokens || 4096,
      tools: tools.length > 0 ? tools : undefined,
    })

    const toolCalls = result.toolCalls?.map(tc => ({
      name: tc.toolName,
      args: tc.args as Record<string, unknown>,
      id: tc.toolCallId,
    }))

    return {
      content: result.text || "",
      toolCalls: toolCalls?.length ? toolCalls : undefined,
      usage: result.usage ? {
        inputTokens: result.usage.promptTokens,
        outputTokens: result.usage.completionTokens,
      } : undefined,
      stopReason: result.finishReason === "tool-use" ? "tool_use"
        : result.finishReason === "length" ? "max_tokens"
        : "stop",
      provider: PROVIDER_INFO.id,
      model,
    }
  }

  return { info: PROVIDER_INFO, execute }
}

registerProvider("gemini" as ProviderId, {
  info: PROVIDER_INFO,
  create: createGeminiProvider,
})