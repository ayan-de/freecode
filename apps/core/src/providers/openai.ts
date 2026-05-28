import { createOpenAI } from '@ai-sdk/openai'
import { generateText } from 'ai'
import { AIProvider, ExecuteOptions, ExecuteResult } from './types'
import { getApiKey, ProviderId } from './config'
import { registerProvider } from './registry'

const PROVIDER_INFO = {
  id: "openai" as const,
  name: "OpenAI",
  defaultModel: "gpt-4o",
  supportsStreaming: true,
  supportsTools: true,
}

function createOpenAIProvider(_apiKey: string): AIProvider {
  const openai = createOpenAI({ apiKey: getApiKey("openai" as ProviderId) })

  async function execute(opts: ExecuteOptions): Promise<ExecuteResult> {
    const model = opts.model || PROVIDER_INFO.defaultModel

    const tools = opts.tools?.map(tool => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    })) || []

    const result = await generateText({
      model: openai(model),
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

registerProvider("openai" as ProviderId, {
  info: PROVIDER_INFO,
  create: createOpenAIProvider,
})