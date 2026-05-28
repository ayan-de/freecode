export type MemoryRole = "system" | "user" | "assistant"

export interface MemoryMessage {
  id: string
  role: MemoryRole
  content: string
  timestamp: number
  tokenCount: number
}

export interface CompactionSummary {
  id: string
  createdAt: number
  originalMessageCount: number
  originalTokenCount: number
  summaryTokenCount: number
  content: string
}

export interface MemoryState {
  sessionId: string
  messages: MemoryMessage[]
  summaries: CompactionSummary[]
  tokenCount: number
  totalCompactions: number
  lastCompactionAt?: number
}

export interface CompactionConfig {
  autoCompactBufferTokens: number
  warningBufferTokens: number
  preserveRecentTurns: number
  minPreserveRecentTokens: number
  maxPreserveRecentTokens: number
  maxToolOutputChars: number
}

export interface SelectionResult {
  summarize: MemoryMessage[]
  preserve: MemoryMessage[]
  summarizeTokenCount: number
  preserveTokenCount: number
}

export interface CompactionResult {
  success: boolean
  blocked?: boolean
  reason?: string
  summary?: CompactionSummary
  preservedMessageIds: string[]
  compactedMessageIds: string[]
  tokenCountBefore: number
  tokenCountAfter: number
}

export interface PromptMemoryContext {
  summary?: string
  recentMessages: MemoryMessage[]
  tokenCount: number
}

export const DEFAULT_COMPACTION_CONFIG: CompactionConfig = {
  autoCompactBufferTokens: 13_000,
  warningBufferTokens: 20_000,
  preserveRecentTurns: 2,
  minPreserveRecentTokens: 2_000,
  maxPreserveRecentTokens: 8_000,
  maxToolOutputChars: 2_000,
}
