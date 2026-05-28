import type { CompactionSummary, MemoryMessage } from "./types.js"
import { estimateTokenCount } from "./tokens.js"

interface SummarizeInput {
  sessionId: string
  previousSummary?: string
  messages: MemoryMessage[]
}

function clip(text: string, maxChars: number): string {
  return text.length <= maxChars ? text : `${text.slice(0, maxChars)}...`
}

export function summarizeMessages(input: SummarizeInput): CompactionSummary {
  const userMessages = input.messages.filter((message) => message.role === "user")
  const assistantMessages = input.messages.filter((message) => message.role === "assistant")
  const files = new Set<string>()

  for (const message of input.messages) {
    for (const match of message.content.matchAll(/(?:apps|packages|docs)\/[^\s)`'"]+/g)) {
      files.add(match[0])
    }
  }

  const lines = [
    "## Goal",
    `- ${clip(userMessages[0]?.content ?? "Continue the current coding session.", 240)}`,
    "",
    "## Previous Summary",
    input.previousSummary ? clip(input.previousSummary, 2_000) : "- (none)",
    "",
    "## Recent Progress",
    ...assistantMessages.slice(-5).map((message) => `- ${clip(message.content, 240)}`),
    assistantMessages.length === 0 ? "- (none)" : "",
    "",
    "## Relevant Files",
    ...([...files].slice(0, 20).map((file) => `- ${file}`)),
    files.size === 0 ? "- (none)" : "",
    "",
    "## Next Context",
    `- Preserved ${input.messages.length} older messages for continuation.`,
  ].filter((line) => line !== undefined)

  const content = lines.join("\n")
  const originalTokenCount = input.messages.reduce((sum, message) => sum + message.tokenCount, 0)

  return {
    id: `summary-${input.sessionId}-${Date.now()}`,
    createdAt: Date.now(),
    originalMessageCount: input.messages.length,
    originalTokenCount,
    summaryTokenCount: estimateTokenCount(content),
    content,
  }
}