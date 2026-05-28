import { createAnthropic } from '@ai-sdk/anthropic'
import { generateText } from 'ai'
import { AIProvider, ExecuteOptions, ExecuteResult } from './types'
import { getApiKey, ProviderId } from './config'
import { registerProvider } from './registry'

const PROVIDER_INFO = {
  id: "anthropic" as const,
  name: "Anthropic",
  defaultModel: "claude-sonnet-4-5",
  supportsStreaming: true,
  supportsTools: true,
}

function createAnthropicProvider(_apiKey: string): AIProvider {
  const anthropic = createAnthropic({ apiKey: getApiKey("anthropic" as ProviderId) })

  async function execute(opts: ExecuteOptions): Promise<ExecuteResult> {
    const model = opts.model || PROVIDER_INFO.defaultModel

    const result = await generateText({
      model: anthropic(model),
      system: opts.system,
      prompt: opts.prompt,
      temperature: opts.temperature,
      maxOutputTokens: opts.maxTokens || 4096,
    })

    const toolCalls = result.toolCalls?.map((tc): { name: string; args: Record<string, unknown>; id: string } => {
      // tc is TypedToolCall<ToolSet> - input is the args, toolCallId is the id
      const input = (tc as unknown as { input: Record<string, unknown> }).input
      return {
        name: tc.toolName,
        args: input,
        id: tc.toolCallId,
      }
    })

    const content = result.text || ""

    return {
      content,
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

// Register on module load
registerProvider("anthropic" as ProviderId, {
  info: PROVIDER_INFO,
  create: createAnthropicProvider,
})