// =============================================================================
// Agent Types - Canonical Runtime Contracts
// PRIMARY: Define all core types used throughout the agent system
// INPUT: N/A (type definitions only)
// OUTPUT: Exported types: ModelTurn, ToolCall, ToolResult, SessionState, LoopHealth, etc.
// PURPOSE: Single source of truth for agent domain types - stabilizing these early
//          is critical as changing them later becomes painful
// =============================================================================

// =============================================================================
// Execution Modes
// Sequential: tools run one after another (edit, write, bash, agent)
// Parallel-safe: independent tools run concurrently (read, grep, glob)
// =============================================================================
export type ExecutionMode = "sequential" | "parallel-safe"

// =============================================================================
// Core Turn Types
// ModelTurn: Complete response from AI provider
// ToolCall: Single tool invocation request
// ToolResult: Execution result of a tool call
// =============================================================================

export interface ModelTurn {
  id: string
  provider: ProviderID
  reasoning?: string
  content: AssistantContent[]
  toolCalls: ToolCall[]
  stopReason: StopReason
  usage?: { inputTokens?: number; outputTokens?: number }
  raw?: unknown
}

export type StopReason = "tool_use" | "completed" | "max_tokens" | "error" | "interrupted"

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

// =============================================================================
// Recovery System
// RecoveryPolicy: Defines how to handle different error types
// =============================================================================

export interface RecoveryPolicy {
  canRecover(error: unknown): boolean
  strategy: "retry" | "restart-provider" | "restart-browser" | "rollback-turn" | "abort-session"
  maxAttempts: number
  initialDelay?: number
  backoff?: "linear" | "exponential" | "fixed"
}

// =============================================================================
// Loop Health - Multi-heuristic detection for stuck patterns
// =============================================================================

export interface LoopHealth {
  repeatedTools: number        // Same tool+args repeated
  stagnantTurns: number         // No progress made
  oscillationScore: number      // Edit/revert/edit pattern
  repeatedReasoningScore: number // Similar reasoning repeated
}

export interface LoopHeuristics {
  // A. Repeated identical tool call - same tool + same args 3x → hard stop
  repeatedIdenticalThreshold: number
  // B. No state change - 5 turns with no file changes → warning
  stagnantTurnsThreshold: number
  // C. Oscillation - edit A, revert A, edit A → block
  oscillationScoreThreshold: number
  // D. Repeated reasoning similarity - >90% for N turns → likely stuck
  reasoningSimilarityThreshold: number
  reasoningSimilarityTurns: number
  // E. Hard cap on total iterations
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

// =============================================================================
// Session State Machine
// States: idle → starting → running → error/stopped
// =============================================================================

export interface SessionState {
  status: "idle" | "starting" | "running" | "error" | "stopped"
  sessionId: string
  turnCount: number
  iterationCount: number
  loopHealth: LoopHealth
  pendingToolCalls: ToolCall[]
  activeToolChain?: string[]  // For compaction awareness
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

// =============================================================================
// Message Types - Conversation history
// =============================================================================

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

// =============================================================================
// User Input / Loop Result - Main entry/exit types
// =============================================================================

import type { StreamEvent } from "@freecode/shared"

export interface UserInput {
  prompt: string
  sessionId: string
  provider: string
  model?: string
  projectPath: string
  onToolEvent?: (event: StreamEvent) => void
}

export interface LoopResult {
  success: boolean
  message?: string
  content?: string
  turnCount: number
  iterationCount: number
  finalState: SessionState
  usage?: { inputTokens: number; outputTokens: number }
}

// =============================================================================
// Hook System - 10 event types for extensibility
// =============================================================================

export interface HookContext {
  sessionId: string
  turnCount: number
  toolName?: string
  [key: string]: unknown
}

export interface HookResult {
  action: "continue" | "block" | "inject"
  reason?: string
  injectContext?: Record<string, unknown>
}