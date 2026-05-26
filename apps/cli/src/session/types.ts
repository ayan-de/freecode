// =============================================================================
// Session Types - Canonical Runtime Contracts
// =============================================================================

export type ExecutionMode = "sequential" | "parallel-safe"

export interface ModelTurn {
  id: string
  provider: ProviderID
  reasoning?: string
  content: AssistantContent[]
  toolCalls: ToolCall[]
  stopReason:
    | "tool_use"
    | "completed"
    | "max_tokens"
    | "error"
    | "interrupted"
  usage?: {
    inputTokens?: number
    outputTokens?: number
  }
  raw?: unknown
}

export type AssistantContent =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }

export interface ToolCall {
  id: string
  tool: string
  args: unknown
  execution: ExecutionMode
}

export interface ToolResult {
  id: string
  toolCallId: string
  tool: string
  title: string
  stdout?: string
  stderr?: string
  exitCode?: number
  duration_ms?: number
  artifacts?: Artifact[]
  structuredData?: unknown
  truncated?: boolean
  error?: string
}

export interface Artifact {
  type: string
  content: string
  language?: string
}

export type ProviderID = "chatgpt" | "claude" | "gemini" | string

export interface RecoveryPolicy {
  canRecover(error: unknown): boolean
  strategy:
    | "retry"
    | "restart-provider"
    | "restart-browser"
    | "rollback-turn"
    | "abort-session"
  maxAttempts: number
  initialDelay?: number
  backoff?: "linear" | "exponential" | "fixed"
}

export interface LoopHealth {
  repeatedTools: number
  stagnantTurns: number
  oscillationScore: number
  repeatedReasoningScore: number
}

export interface SessionState {
  status: "idle" | "starting" | "running" | "error" | "stopped"
  sessionId: string
  turnCount: number
  iterationCount: number
  loopHealth: LoopHealth
  pendingToolCalls: ToolCall[]
  activeToolChain?: string[]
}

export interface Message {
  id: string
  role: "user" | "assistant"
  parts: MessagePart[]
  timestamp: number
}

export type MessagePart =
  | { type: "text"; content: string }
  | { type: "code"; language: string; content: string }
  | { type: "tool"; tool: ToolCall; result?: string }

export interface SessionConfig {
  projectPath: string
  provider: ProviderID
  maxIterations?: number
  loopHeuristics?: Partial<LoopHeuristics>
}

export interface LoopHeuristics {
  repeatedIdenticalThreshold: number
  stagnantTurnsThreshold: number
  oscillationScoreThreshold: number
  reasoningSimilarityThreshold: number
  reasoningSimilarityTurns: number
  totalIterationLimit: number
}

export const DEFAULT_LOOP_HEURISTICS: LoopHeuristics = {
  repeatedIdenticalThreshold: 3,
  stagnantTurnsThreshold: 5,
  oscillationScoreThreshold: 4,
  reasoningSimilarityThreshold: 0.9,
  reasoningSimilarityTurns: 3,
  totalIterationLimit: 100,
}

export interface LoopAction {
  action: "continue" | "warn" | "stop"
  reason?: string
}

export function createInitialSessionState(sessionId: string): SessionState {
  return {
    status: "idle",
    sessionId,
    turnCount: 0,
    iterationCount: 0,
    loopHealth: {
      repeatedTools: 0,
      stagnantTurns: 0,
      oscillationScore: 0,
      repeatedReasoningScore: 0,
    },
    pendingToolCalls: [],
  }
}