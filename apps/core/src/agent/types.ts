// =============================================================================
// Agent Types - Canonical Runtime Contracts
// PRIMARY: Define all core types used throughout the agent system
// INPUT: N/A (type definitions only)
// OUTPUT: Exported types: ModelTurn, ToolCall, ToolResult, SessionState, LoopHealth, etc.
// PURPOSE: Single source of truth for agent domain types - stabilizing these early
//          is critical as changing them later becomes painful
// =============================================================================

// =============================================================================
// Agent Mode - First-class operating modes
// plan: read-only planning/review mode
// build: normal editing mode
// review: code review mode
// explore: exploration mode
// =============================================================================
export type AgentMode = "plan" | "build" | "review" | "explore" | "danger";

export const AGENT_MODES: AgentMode[] = [
  "plan",
  "build",
  "review",
  "explore",
  "danger",
];

export const AGENT_MODE_LABELS: Record<AgentMode, string> = {
  plan: "Plan",
  build: "Build",
  review: "Review",
  explore: "Explore",
  danger: "Danger",
};

// =============================================================================
// Subagent Types - Specialized agent roles for delegation
// =============================================================================
export type SubagentType =
  | "explorer"
  | "reviewer"
  | "tester"
  | "summarizer"
  | "verifier";

export interface SubagentConfig {
  type: SubagentType;
  /** Model to use for this subagent (defaults to main model) */
  model?: string;
  /** Max iterations for this subagent */
  maxIterations?: number;
  /** Whether this subagent can modify files */
  readOnly?: boolean;
  /** System prompt additions */
  systemPrompt?: string;
  /** Task-specific prompt */
  taskPrompt: string;
  /** Parent session ID to fork: the sub-agent's session starts with the
   * parent's full conversation history instead of just the task prompt.
   * Omit for the default isolated-context behavior. */
  forkFrom?: string;
}

export const SUBAGENT_DEFINITIONS: Record<
  SubagentType,
  { description: string; defaultReadOnly: boolean }
> = {
  explorer: {
    description:
      "Explore codebase structure, find patterns, understand architecture",
    defaultReadOnly: true,
  },
  reviewer: {
    description: "Review code for bugs, security issues, performance problems",
    defaultReadOnly: true,
  },
  tester: {
    description: "Write and run tests, verify functionality",
    defaultReadOnly: false,
  },
  summarizer: {
    description: "Summarize long conversations, documents, or code",
    defaultReadOnly: true,
  },
  verifier: {
    description:
      "Independently and adversarially verify that completed changes satisfy the request and are correct; assigns a PASS/FAIL/PARTIAL verdict",
    defaultReadOnly: true,
  },
};

// =============================================================================
// Execution Modes
// Sequential: tools run one after another (edit, write, bash, agent)
// Parallel-safe: independent tools run concurrently (read, grep, glob)
// =============================================================================
export type ExecutionMode = "sequential" | "parallel-safe";

// =============================================================================
// Core Turn Types
// ModelTurn: Complete response from AI provider
// ToolCall: Single tool invocation request
// ToolResult: Execution result of a tool call
// =============================================================================

export interface ModelTurn {
  id: string;
  provider: ProviderID;
  reasoning?: string;
  content: AssistantContent[];
  toolCalls: ToolCall[];
  stopReason: StopReason;
  usage?: { inputTokens?: number; outputTokens?: number };
  raw?: unknown;
}

export type StopReason =
  | "tool_use"
  | "completed"
  | "max_tokens"
  | "error"
  | "interrupted";

export type AssistantContent =
  | { type: "text"; text: string }
  | {
      type: "tool_use";
      id: string;
      name: string;
      input: Record<string, unknown>;
    };

export interface ToolCall {
  id: string;
  tool: string;
  args: unknown;
  execution: ExecutionMode;
}

export interface ToolResult {
  id: string;
  toolCallId: string;
  tool: string;
  title: string;
  /** Full output for UI display */
  displayOutput?: string;
  /** Truncated output for model (capped at ~500 chars to save tokens) */
  modelOutput?: string;
  /** Path to full artifact file if output was truncated */
  artifactPath?: string;
  /** Legacy field - use displayOutput/modelOutput instead */
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  duration_ms?: number;
  artifacts?: Artifact[];
  structuredData?: unknown;
  truncated?: boolean;
  error?: string;
}

export interface Artifact {
  type: string;
  content: string;
  language?: string;
}

export type ProviderID = "chatgpt" | "claude" | "gemini" | string;

// =============================================================================
// Recovery System
// RecoveryPolicy: Defines how to handle different error types
// =============================================================================

export interface RecoveryPolicy {
  canRecover(error: unknown): boolean;
  strategy:
    | "retry"
    | "restart-provider"
    | "restart-browser"
    | "rollback-turn"
    | "abort-session";
  maxAttempts: number;
  initialDelay?: number;
  backoff?: "linear" | "exponential" | "fixed";
}

// =============================================================================
// Loop Health - Multi-heuristic detection for stuck patterns
// =============================================================================

export interface LoopHealth {
  repeatedTools: number; // Same tool+args repeated
  stagnantTurns: number; // No progress made
  oscillationScore: number; // Edit/revert/edit pattern
  repeatedReasoningScore: number; // Similar reasoning repeated
}

export interface LoopHeuristics {
  // A. Repeated identical tool call - same tool + same args 3x → hard stop
  repeatedIdenticalThreshold: number;
  // B. No state change - 5 turns with no file changes → warning
  stagnantTurnsThreshold: number;
  // C. Oscillation - edit A, revert A, edit A → block
  oscillationScoreThreshold: number;
  // D. Repeated reasoning similarity - >90% for N turns → likely stuck
  reasoningSimilarityThreshold: number;
  reasoningSimilarityTurns: number;
  // E. Hard cap on total iterations
  totalIterationLimit: number;
}

export const DEFAULT_LOOP_HEURISTICS: LoopHeuristics = {
  repeatedIdenticalThreshold: 3,
  stagnantTurnsThreshold: 5,
  oscillationScoreThreshold: 4,
  reasoningSimilarityThreshold: 0.9,
  reasoningSimilarityTurns: 3,
  // Unbounded by default, matching AgentLoopConfig.maxIterations — the
  // repeated-tool/stagnation/oscillation heuristics above are what actually
  // catch stuck patterns. Callers that want a hard turn cap (subagents,
  // headless/-p invocations) already pass maxIterations explicitly, which
  // trips before this would.
  totalIterationLimit: Infinity,
};

export interface LoopAction {
  action: "continue" | "warn" | "stop";
  reason?: string;
}

// =============================================================================
// Session State Machine
// States: idle → starting → running → error/stopped
// =============================================================================

export interface SessionState {
  status: "idle" | "starting" | "running" | "error" | "stopped";
  sessionId: string;
  projectPath: string;
  turnCount: number;
  iterationCount: number;
  agentMode: AgentMode;
  loopHealth: LoopHealth;
  pendingToolCalls: ToolCall[];
  activeToolChain?: string[]; // For compaction awareness
}

export function createInitialSessionState(
  sessionId: string,
  projectPath: string,
): SessionState {
  return {
    status: "idle",
    sessionId,
    projectPath,
    turnCount: 0,
    iterationCount: 0,
    agentMode: "build",
    loopHealth: {
      repeatedTools: 0,
      stagnantTurns: 0,
      oscillationScore: 0,
      repeatedReasoningScore: 0,
    },
    pendingToolCalls: [],
  };
}

// =============================================================================
// Message Types - Conversation history
// =============================================================================

export interface Message {
  id: string;
  role: "user" | "assistant";
  parts: MessagePart[];
  timestamp: number;
}

export type MessagePart =
  | { type: "text"; content: string }
  | { type: "code"; language: string; content: string }
  | { type: "tool"; tool: ToolCall; result?: string }
  | {
      type: "image";
      /** Base64-encoded image data (without the data:image/xxx;base64, prefix) */
      data: string;
      /** Media type: image/png, image/jpeg, image/gif, image/webp */
      mediaType: string;
      /** Optional plain-text description for providers without vision support */
      altText?: string;
    };

// =============================================================================
// User Input / Loop Result - Main entry/exit types
// =============================================================================

export interface UserInput {
  prompt: string;
  /** Images attached to the prompt, shown to vision-capable providers. */
  images?: Array<{ data: string; mediaType: string; altText?: string }>;
  sessionId: string;
  provider: string;
  model?: string;
  projectPath: string;
  agentMode?: AgentMode;
}

export interface LoopResult {
  success: boolean;
  message?: string;
  content?: string;
  thinking?: string; // Extended thinking content from provider
  turnCount: number;
  iterationCount: number;
  finalState: SessionState;
  usage?: {
    // NOTE: already includes cache writes — they are billed input, so folding
    // them in keeps ↓ honest on turn 1. `cacheCreationInputTokens` below is the
    // same tokens reported separately for the cache hit rate, NOT an addition.
    inputTokens: number;
    outputTokens: number;
    cacheReadInputTokens?: number;
    cacheCreationInputTokens?: number;
    // Last API call's full input — true context-window occupancy
    contextTokens?: number;
  };
}

// =============================================================================
// Hook System - 10 event types for extensibility
// =============================================================================

export interface HookContext {
  sessionId: string;
  turnCount: number;
  toolName?: string;
  [key: string]: unknown;
}

export interface HookResult {
  action: "continue" | "block" | "inject";
  reason?: string;
  injectContext?: Record<string, unknown>;
}
