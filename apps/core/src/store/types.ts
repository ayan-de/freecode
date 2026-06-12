// =============================================================================
// Thread Store Types - Session persistence for FreeCode
// PRIMARY: Define types for thread storage, turns, and filtering
// STORAGE: SQLite primary with JSON file fallback
// =============================================================================

// ============================================================================
// Thread State Machine
// ============================================================================

export type ThreadStatus = "active" | "archived" | "deleted";

export type ThreadGoalStatus = "pending" | "active" | "completed" | "failed";

// ============================================================================
// StoredThread - Full thread data stored in database
// ============================================================================

export interface StoredThread {
  // Identity
  id: string;
  title: string;

  // Metadata
  createdAt: number;
  updatedAt: number;
  lastTurnAt: number;
  status: ThreadStatus;

  // Context
  projectPath: string;
  provider: string;

  // State
  turnCount: number;
  iterationCount: number;

  // Goal tracking
  goal?: string;
  goalStatus?: ThreadGoalStatus;
  goalUpdatedAt?: number;
}

// ============================================================================
// StoredTurn - A single turn in a thread (user message + assistant response)
// ============================================================================

export interface StoredTurn {
  // Identity
  id: string;
  threadId: string;
  turnNumber: number;

  // Content
  prompt: string;
  response?: string;

  // Timing
  createdAt: number;
  durationMs?: number;

  // Results
  toolCallCount: number;
  toolCalls?: StoredToolCall[];
}

// ============================================================================
// StoredToolCall - Individual tool call within a turn
// ============================================================================

export interface StoredToolCall {
  id: string;
  toolName: string;
  args: Record<string, unknown>;
  result?: string;
  error?: string;
  durationMs?: number;
  sequence: number;
}

// ============================================================================
// StoredTurnItemsView - Aggregated view for display (turn + tool calls)
// ============================================================================

export interface StoredTurnItemsView {
  threadId: string;
  turnNumber: number;
  prompt: string;
  response?: string;
  createdAt: number;
  toolCalls: Array<{
    id: string;
    toolName: string;
    result?: string;
    error?: string;
    durationMs?: number;
  }>;
}

// ============================================================================
// ThreadFilter - Filter options for listing/searching threads
// ============================================================================

export interface ThreadFilter {
  status?: ThreadStatus;
  projectPath?: string;
  provider?: string;
  limit?: number;
  offset?: number;
}

// ============================================================================
// ThreadStore Interface - Abstract persistence layer
// ============================================================================

export interface ThreadStore {
  // Thread CRUD
  createThread(
    thread: Omit<StoredThread, "id" | "createdAt" | "updatedAt">,
  ): Promise<string>;
  getThread(threadId: string): Promise<StoredThread | null>;
  updateThread(threadId: string, updates: Partial<StoredThread>): Promise<void>;
  archiveThread(threadId: string): Promise<void>;
  deleteThread(threadId: string): Promise<void>;
  listThreads(filter?: ThreadFilter): Promise<StoredThread[]>;
  searchThreads(query: string): Promise<StoredThread[]>;

  // Turn operations
  createTurn(turn: Omit<StoredTurn, "id" | "createdAt">): Promise<string>;
  getTurn(turnId: string): Promise<StoredTurn | null>;
  getTurnsForThread(threadId: string): Promise<StoredTurn[]>;
  getTurnItemsView(
    threadId: string,
    limit?: number,
  ): Promise<StoredTurnItemsView[]>;

  // Tool call operations
  addToolCall(
    turnId: string,
    toolCall: Omit<StoredToolCall, "id" | "sequence">,
  ): Promise<string>;

  // Utility
  close(): Promise<void>;
}

// ============================================================================
// JSON Store Types - For JSON file fallback
// ============================================================================

export interface JsonThreadStore {
  threads: Record<string, StoredThread>;
  turns: Record<string, StoredTurn[]>;
  metadata: {
    version: number;
    lastUpdated: number;
  };
}
