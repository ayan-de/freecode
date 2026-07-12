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
} from "./types.js";

// Thread Store
export {
  getThreadStore,
  createThreadStore,
  closeThreadStore,
  createThreadStoreService,
  ThreadStoreService,
} from "./thread-store.js";

// JSON Store
export { JsonThreadStoreImpl, createJsonThreadStore } from "./json-store.js";

// SQLite Store
export { SqliteThreadStoreImpl } from "./sqlite-store.js";

// Remote Session Sync
export {
  RemoteSessionSync,
  getRemoteSync,
  type ExportedSession,
  type RemoteSessionConfig,
} from "./remote.js";

// Path Formatter
export {
  formatSessionDirName,
  parseSessionDirName,
  isSessionDirName,
} from "./path-formatter.js";
