// =============================================================================
// Store Module - Public API
// PRIMARY: Thread/turn persistence with SQLite + JSON fallback
// =============================================================================

// Types
export type {
  ThreadStore,
  StoredThread,
  StoredTurn,
  StoredToolCall,
  ThreadFilter,
  StoredTurnItemsView,
  ThreadStatus,
  ThreadGoalStatus,
} from "./types"

// Thread Store
export {
  getThreadStore,
  createThreadStore,
  closeThreadStore,
  createThreadStoreService,
  ThreadStoreService,
} from "./thread-store"

// JSON Store
export { JsonThreadStoreImpl, createJsonThreadStore } from "./json-store"

// SQLite Store
export { SqliteThreadStoreImpl } from "./sqlite-store"