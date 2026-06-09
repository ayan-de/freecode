import { createAnthropic } from '@ai-sdk/anthropic'
import { generateText } from 'ai'
import { AIProvider, ExecuteOptions, ExecuteResult } from './types.js'
import { getApiKey } from './config.js'
import { registerProvider } from './registry.js'
import { convertToCoreMessages } from './utils.js'

const PROVIDER_INFO = {
  id: "anthropic" as const,
  name: "Anthropic",
  defaultModel: "claude-sonnet-4-5",
  supportsStreaming: true,
  supportsTools: true,
}

function createAnthropicProvider(_apiKey: string): AIProvider {
  const anthropic = createAnthropic({ apiKey: getApiKey("anthropic") })

  async function execute(opts: ExecuteOptions): Promise<ExecuteResult> {
    const model = opts.model || PROVIDER_INFO.defaultModel

    const tools = opts.tools?.reduce((acc, t) => {
      acc[t.name] = {
        description: t.description,
        inputSchema: t.parameters as Record<string, unknown>,
      }
      return acc
    }, {} as Record<string, { description: string; inputSchema: Record<string, unknown> }>)

    // Cast to any to satisfy AI SDK's ToolSet type which expects FlexibleSchema<never>
    // The underlying implementation accepts plain JSON schema objects
    const generateOptions: any = {
      model: anthropic(model),
      temperature: opts.temperature,
      maxOutputTokens: opts.maxTokens || 4096,
      tools: tools as any,
    }

    if (opts.system) {
      if (typeof opts.system === 'string') {
        generateOptions.system = opts.system
      } else {
        generateOptions.system = opts.system.map(block => {
          const part: any = { type: 'text', text: block.text }
          if (block.cache) {
            part.providerOptions = {
              anthropic: { cacheControl: { type: 'ephemeral' } }
            }
          }
          return part
        })
      }
    }

    if (opts.messages) {
      const coreMessages = convertToCoreMessages(opts.messages)
      if (coreMessages.length > 0) {
        const lastMsg = coreMessages[coreMessages.length - 1]
        if (lastMsg) {
          if (typeof lastMsg.content === 'string') {
            lastMsg.content = [
              {
                type: 'text',
                text: lastMsg.content,
                providerOptions: {
                  anthropic: { cacheControl: { type: 'ephemeral' } }
                }
              } as any
            ]
          } else if (Array.isArray(lastMsg.content)) {
            const lastPart = lastMsg.content[lastMsg.content.length - 1]
            if (lastPart && typeof lastPart === 'object') {
              (lastPart as any).providerOptions = {
                anthropic: { cacheControl: { type: 'ephemeral' } }
              }
            }
          }
        }
      }
      generateOptions.messages = coreMessages
    } else {
      generateOptions.prompt = opts.prompt
    }

    const result = await generateText(generateOptions)

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
    const anthropicMetadata = result.providerMetadata?.anthropic as any

    return {
      content,
      thinking: undefined,  // V3 SDK doesn't expose thinking blocks
      toolCalls: toolCalls?.length ? toolCalls : undefined,
      usage: result.usage ? {
        inputTokens: result.usage.inputTokens ?? 0,
        outputTokens: result.usage.outputTokens ?? 0,
        cacheCreationInputTokens: anthropicMetadata?.cacheCreationInputTokens ?? undefined,
        cacheReadInputTokens: anthropicMetadata?.cacheReadInputTokens ?? undefined,
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
registerProvider("anthropic", {
  info: PROVIDER_INFO,
  create: createAnthropicProvider,
})