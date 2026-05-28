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

    const result = await generateText({
      model: openai(model),
      system: opts.system,
      prompt: opts.prompt,
      temperature: opts.temperature,
      maxOutputTokens: opts.maxTokens || 4096,
    })

    const toolCalls = result.toolCalls?.map((tc): { name: string; args: Record<string, unknown>; id: string } => {
      const input = (tc as unknown as { input: Record<string, unknown> }).input
      return {
        name: tc.toolName,
        args: input,
        id: tc.toolCallId,
      }
    })

    return {
      content: result.text || "",
      toolCalls: toolCalls?.length ? toolCalls : undefined,
      usage: result.usage ? {
        inputTokens: result.usage.inputTokens ?? 0,
        outputTokens: result.usage.outputTokens ?? 0,
      } : undefined,
      stopReason: result.finishReason === "tool-calls" ? "tool_use"
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