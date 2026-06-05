import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { generateText } from 'ai'
import { AIProvider, ExecuteOptions, ExecuteResult } from './types'
import { getApiKey } from './config'
import { registerProvider } from './registry'

const PROVIDER_INFO = {
  id: "gemini" as const,
  name: "Google Gemini",
  defaultModel: "gemini-2.0-flash",
  supportsStreaming: true,
  supportsTools: true,
}

function createGeminiProvider(_apiKey: string): AIProvider {
  const gemini = createGoogleGenerativeAI({ apiKey: getApiKey("gemini") })

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
    const result = await generateText({
      model: gemini.languageModel(model),
      system: opts.system,
      prompt: opts.prompt,
      temperature: opts.temperature,
      maxOutputTokens: opts.maxTokens || 4096,
      tools: tools as any,
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
      thinking: undefined,  // Gemini doesn't expose thinking blocks
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

registerProvider("gemini", {
  info: PROVIDER_INFO,
  create: createGeminiProvider,
})