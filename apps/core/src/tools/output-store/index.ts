// =============================================================================
// OutputStore factory - one store instance per session, held in a bounded LRU.
// The daemon is long-running and may touch many sessions; the least-recently-used
// store is evicted and disposed. Losing a store just means its outputs degrade to
// "re-run the tool" (spec D4). Dropped explicitly on session.delete.
// =============================================================================

import { OutputStore } from "./store.js";
import { MAX_SESSIONS } from "./config.js";

export { OutputStore } from "./store.js";
export { adaptiveTruncate } from "./truncate.js";

const stores = new Map<string, OutputStore>();

export function getOutputStore(sessionId: string): OutputStore {
  const existing = stores.get(sessionId);
  if (existing) {
    stores.delete(sessionId); // LRU touch
    stores.set(sessionId, existing);
    return existing;
  }
  const store = new OutputStore();
  stores.set(sessionId, store);
  while (stores.size > MAX_SESSIONS) {
    const oldest = stores.keys().next().value as string | undefined;
    if (oldest === undefined) break;
    stores.get(oldest)?.dispose();
    stores.delete(oldest);
  }
  return store;
}

export function disposeOutputStore(sessionId: string): void {
  stores.get(sessionId)?.dispose();
  stores.delete(sessionId);
}
