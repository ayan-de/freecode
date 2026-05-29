// =============================================================================
// Thread Store - Unified interface for session persistence
// PRIMARY: Create and manage threads, turns, and tool calls
// FALLBACK: SQLite → JSON file if SQLite unavailable
// =============================================================================

import type {
  ThreadStore,
  StoredThread,
  StoredTurn,
  StoredToolCall,
  ThreadFilter,
  StoredTurnItemsView,
} from "./types"
import { JsonThreadStoreImpl, createJsonThreadStore } from "./json-store"

// ============================================================================
// Store Factory - Try SQLite first, fall back to JSON
// ============================================================================

let globalStore: ThreadStore | null = null

/**
 * Get or create the global thread store instance.
 * Uses SQLite if available, falls back to JSON file storage.
 */
export async function getThreadStore(): Promise<ThreadStore> {
  if (globalStore) return globalStore

  // Try SQLite first
  try {
    const { SqliteThreadStoreImpl } = await import("./sqlite-store")
    const sqliteStore = await SqliteThreadStoreImpl.create()
    if (sqliteStore.isAvailable()) {
      globalStore = sqliteStore
      console.log("[ThreadStore] Using SQLite backend")
      return globalStore
    }
  } catch (error) {
    console.warn(`[ThreadStore] SQLite not available: ${error}`)
  }

  // Fall back to JSON store
  globalStore = createJsonThreadStore()
  console.log("[ThreadStore] Using JSON file backend")
  return globalStore
}

/**
 * Create a new thread store instance (for testing or isolated use)
 */
export async function createThreadStore(): Promise<ThreadStore> {
  try {
    const { SqliteThreadStoreImpl } = await import("./sqlite-store")
    const sqliteStore = await SqliteThreadStoreImpl.create()
    if (sqliteStore.isAvailable()) {
      return sqliteStore
    }
  } catch (error) {
    console.warn(`[ThreadStore] SQLite not available: ${error}`)
  }
  return createJsonThreadStore()
}

/**
 * Close the global thread store
 */
export async function closeThreadStore(): Promise<void> {
  if (globalStore) {
    await globalStore.close()
    globalStore = null
  }
}

// ============================================================================
// Thread Store Service - High-level operations
// ============================================================================

export class ThreadStoreService {
  private store: ThreadStore

  constructor(store: ThreadStore) {
    this.store = store
  }

  // ===========================================================================
  // Thread Operations
  // ===========================================================================

  /**
   * Create a new thread
   */
  async create(
    title: string,
    projectPath: string,
    provider: string,
    goal?: string
  ): Promise<string> {
    return this.store.createThread({
      title,
      projectPath,
      provider,
      goal,
      goalStatus: goal ? "pending" : undefined,
      status: "active",
      turnCount: 0,
      iterationCount: 0,
      lastTurnAt: Date.now(),
    })
  }

  /**
   * Get a thread by ID
   */
  async get(threadId: string): Promise<StoredThread | null> {
    return this.store.getThread(threadId)
  }

  /**
   * Update thread metadata
   */
  async update(threadId: string, updates: Partial<StoredThread>): Promise<void> {
    return this.store.updateThread(threadId, updates)
  }

  /**
   * Archive a thread (soft delete)
   */
  async archive(threadId: string): Promise<void> {
    return this.store.archiveThread(threadId)
  }

  /**
   * Delete a thread permanently
   */
  async delete(threadId: string): Promise<void> {
    return this.store.deleteThread(threadId)
  }

  /**
   * List threads with optional filtering
   */
  async list(filter?: ThreadFilter): Promise<StoredThread[]> {
    return this.store.listThreads(filter)
  }

  /**
   * Search threads by title, project, or goal
   */
  async search(query: string): Promise<StoredThread[]> {
    return this.store.searchThreads(query)
  }

  // ===========================================================================
  // Turn Operations
  // ===========================================================================

  /**
   * Add a turn to a thread
   */
  async addTurn(
    threadId: string,
    turnNumber: number,
    prompt: string,
    response?: string,
    toolCallCount?: number
  ): Promise<string> {
    return this.store.createTurn({
      threadId,
      turnNumber,
      prompt,
      response,
      toolCallCount: toolCallCount || 0,
      toolCalls: [],
    })
  }

  /**
   * Get all turns for a thread
   */
  async getTurns(threadId: string): Promise<StoredTurn[]> {
    return this.store.getTurnsForThread(threadId)
  }

  /**
   * Get turns with tool calls as a view (for display)
   */
  async getTurnItemsView(threadId: string, limit?: number): Promise<StoredTurnItemsView[]> {
    return this.store.getTurnItemsView(threadId, limit)
  }

  // ===========================================================================
  // Tool Call Operations
  // ===========================================================================

  /**
   * Add a tool call to a turn
   */
  async addToolCall(
    turnId: string,
    toolName: string,
    args: Record<string, unknown>,
    result?: string,
    error?: string,
    durationMs?: number
  ): Promise<string> {
    return this.store.addToolCall(turnId, {
      toolName,
      args,
      result,
      error,
      durationMs,
    })
  }

  // ===========================================================================
  // Goal Tracking
  // ===========================================================================

  /**
   * Update the goal status for a thread
   */
  async updateGoalStatus(
    threadId: string,
    goalStatus: "pending" | "active" | "completed" | "failed"
  ): Promise<void> {
    return this.store.updateThread(threadId, {
      goalStatus,
      goalUpdatedAt: Date.now(),
    })
  }

  // ===========================================================================
  // Convenience Methods
  // ===========================================================================

  /**
   * List recent threads for a project
   */
  async recentForProject(projectPath: string, limit: number = 10): Promise<StoredThread[]> {
    return this.store.listThreads({ projectPath, limit })
  }

  /**
   * List all active threads
   */
  async activeThreads(): Promise<StoredThread[]> {
    return this.store.listThreads({ status: "active" })
  }
}

// ============================================================================
// Factory helper
// ============================================================================

/**
 * Create a ThreadStoreService with automatic backend selection
 */
export async function createThreadStoreService(): Promise<ThreadStoreService> {
  const store = await getThreadStore()
  return new ThreadStoreService(store)
}

// ============================================================================
// Re-export types
// ============================================================================

export type {
  StoredThread,
  StoredTurn,
  StoredToolCall,
  ThreadFilter,
  StoredTurnItemsView,
  ThreadStore,
} from "./types"