import { AIProvider, ExecuteOptions, ExecuteResult } from './types.js'
import { getApiKey } from './config.js'
import { registerProvider } from './registry.js'

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
    const apiKey = getApiKey("minimax")

    const messages: Array<{ role: "user" | "assistant"; content: string | Array<{ type: string; [key: string]: unknown }> }> = []
    if (opts.system) {
      const systemPrompt = typeof opts.system === 'string'
        ? opts.system
        : opts.system.map(b => b.text).join('\n\n')
      messages.push({ role: "user", content: systemPrompt })
    }

    if (opts.messages) {
      for (const msg of opts.messages) {
        const textParts: string[] = []
        const toolCalls: Array<{ type: string; id: string; name: string; input: Record<string, unknown> }> = []
        const toolResults: Array<{ type: string; tool_use_id: string; content: string }> = []

        for (const part of msg.parts) {
          if (part.type === 'text') {
            textParts.push(part.content)
          } else if (part.type === 'code') {
            textParts.push(`\`\`\`${part.language}\n${part.content}\n\`\`\``)
          } else if (part.type === 'tool') {
            toolCalls.push({
              type: "tool_use",
              id: part.tool.id,
              name: part.tool.tool,
              input: part.tool.args as Record<string, unknown>,
            })
            if (part.result !== undefined) {
              toolResults.push({
                type: "tool_result",
                tool_use_id: part.tool.id,
                content: part.result,
              })
            }
          }
        }

        if (msg.role === 'user') {
          if (textParts.length > 0) {
            messages.push({ role: 'user', content: textParts.join('\n\n') })
          }
        } else if (msg.role === 'assistant') {
          if (toolCalls.length > 0) {
            const content: Array<{ type: string; [key: string]: unknown }> = []
            if (textParts.length > 0) {
              content.push({ type: 'text', text: textParts.join('\n\n') })
            }
            content.push(...toolCalls)
            messages.push({ role: 'assistant', content })
          } else if (textParts.length > 0) {
            messages.push({ role: 'assistant', content: textParts.join('\n\n') })
          }

          if (toolResults.length > 0) {
            messages.push({ role: 'user', content: toolResults })
          }
        }
      }
    } else {
      // If there are previous tool results, they come AFTER an assistant message with tool_use
      // (following Anthropic message protocol pattern from opencode)
      if (opts.toolResults && opts.toolResults.length > 0) {
        // First, an assistant message with tool_use blocks referencing the calls
        const assistantContent: Array<{ type: string; [key: string]: unknown }> = []
        for (const tr of opts.toolResults) {
          assistantContent.push({
            type: "tool_use",
            id: tr.toolCallId,
            name: tr.name || "unknown",
            input: tr.input || {},
          })
        }
        messages.push({ role: "assistant", content: assistantContent })

        // Then a user message with tool_result blocks
        const userContent: Array<{ type: string; [key: string]: unknown }> = []
        for (const tr of opts.toolResults) {
          userContent.push({
            type: "tool_result",
            tool_use_id: tr.toolCallId,
            content: tr.result || "",
          })
        }
        messages.push({ role: "user", content: userContent })
      }

      // Finally, the new user prompt
      if (opts.prompt) {
        messages.push({ role: "user", content: opts.prompt })
      }
    }

    const body: Record<string, unknown> = {
      model,
      max_tokens: opts.maxTokens || 4096,
      messages,
    }

    // Pass tools to API if provider supports them and tools are provided
    if (opts.tools && opts.tools.length > 0) {
      body.tools = opts.tools.map(tool => ({
        name: tool.name,
        description: tool.description,
        input_schema: {
          type: "object",
          properties: tool.parameters.properties || {},
          required: tool.parameters.required || [],
        },
      }))
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
      content: Array<{ type: string; text?: string; thinking?: string; id?: string; name?: string; input?: Record<string, unknown> }>
      usage: { input_tokens: number; output_tokens: number }
      stop_reason: string
    }

    // Extract text content and thinking blocks separately
    const textParts = data.content?.filter(c => c.type === "text")
    const thinkingParts = data.content?.filter(c => c.type === "thinking")
    const content = textParts?.map(c => c.text || "").join("\n").trim() || ""
    const thinking = thinkingParts?.map(c => c.thinking || "").join("\n").trim() || undefined

    // Extract tool calls from tool_use content blocks
    const toolCalls = data.content
      ?.filter(c => c.type === "tool_use")
      .map(c => ({
        id: c.id || `tool-${Date.now()}`,
        name: c.name || "unknown",
        args: c.input || {},
      })) ?? []

    let stopReason: ExecuteResult["stopReason"] = "unknown"
    if (data.stop_reason === "end_turn" || data.stop_reason === "stop") {
      stopReason = toolCalls.length > 0 ? "tool_use" : "stop"
    } else if (data.stop_reason === "max_tokens") {
      stopReason = "max_tokens"
    } else if (data.stop_reason === "tool_use") {
      stopReason = "tool_use"
    }

    return {
      content,
      thinking,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
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

registerProvider("minimax", {
  info: PROVIDER_INFO,
  create: createMiniMaxProvider,
})