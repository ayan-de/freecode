// =============================================================================
// One session-end signal (spec D3).
//
// The six per-session caches used to hang off `session.delete` alone, so every
// session that ended by switch, archive, stop, or process exit leaked all six.
// This is the single place a session ends, whatever ended it.
//
// It is also where the end-of-session extraction flush lives (D4): the write
// path's interval gate means a session that ends at run 5 extracts nothing, so
// "user states a preference in a one-shot session and it is lost" was the
// documented behaviour. Ending a session is exactly the moment that stops being
// acceptable.
// =============================================================================

import { disposeSessionMemory } from "../memory/index.js";
import { resetExtractPolicy } from "../memory/extract-policy.js";
import { disposeOutputStore } from "../tools/output-store/index.js";
import { disposeReadState } from "../tools/read-state.js";
import { disposePruneState } from "../agent/prune-state.js";
import { disposeCacheAwareness } from "../providers/cache-awareness.js";
import { disposeFrozenSessionContext } from "../context/session-context.js";
import { logger } from "../utils/logger.js";

export type SessionEndReason =
  | "switch"
  | "archive"
  | "stop"
  | "delete"
  | "exit";

// A process that is leaving cannot fire-and-forget: give the flush a bounded
// moment to land, then go regardless. Everything else stays non-blocking.
const EXIT_FLUSH_BUDGET_MS = 2_000;

export interface EndSessionOptions {
  reason: SessionEndReason;
  /**
   * Final extraction pass (D4). Omit and only the disposers run — which is
   * what the tests and the `delete` path want, since a deleted session's
   * memories should not be mined on the way out.
   */
  flush?: () => Promise<unknown>;
  /** Extra per-session cleanup owned by the caller (e.g. the message queue). */
  also?: () => void;
}

// Sessions already ended, so a switch away and back does not flush twice.
// Bounded: a long-lived daemon must not accumulate one string per session
// forever, and re-ending a very old session is harmless (the disposers are all
// idempotent, and its extraction already ran).
const MAX_REMEMBERED = 256;
const ended = new Set<string>();

function markEnded(sessionId: string): boolean {
  if (ended.has(sessionId)) return false;
  ended.add(sessionId);
  if (ended.size > MAX_REMEMBERED) {
    const oldest = ended.values().next().value as string | undefined;
    if (oldest !== undefined) ended.delete(oldest);
  }
  return true;
}

/** Test seam: forget which sessions have ended. */
export function resetEndedSessions(): void {
  ended.clear();
}

/**
 * End a session: run every per-session disposer, then the optional final
 * extraction flush.
 *
 * Idempotent per session id. Never throws — a cleanup failure must not break
 * whatever user action triggered it.
 */
export async function endSession(
  sessionId: string,
  options: EndSessionOptions,
): Promise<void> {
  if (!markEnded(sessionId)) return;

  // Disposers first, and each independently: one throwing must not strand the
  // other five, which is the failure this consolidation is meant to prevent.
  const disposers: Array<[string, () => void]> = [
    ["memory", () => disposeSessionMemory(sessionId)],
    ["extractPolicy", () => resetExtractPolicy(sessionId)],
    ["outputStore", () => disposeOutputStore(sessionId)],
    ["readState", () => disposeReadState(sessionId)],
    ["pruneState", () => disposePruneState(sessionId)],
    ["cacheAwareness", () => disposeCacheAwareness(sessionId)],
    ["sessionContext", () => disposeFrozenSessionContext(sessionId)],
  ];
  for (const [name, dispose] of disposers) {
    try {
      dispose();
    } catch (error) {
      logger.debug(`[EndSession] ${name} disposer failed`, { error });
    }
  }
  options.also?.();

  if (!options.flush) return;

  // The extract policy was just reset, which is deliberate: the flush passes
  // `force` and so bypasses the interval gate anyway, and leaving stale
  // per-session counters behind is what leaked in the first place.
  const flushing = options.flush().catch((error: unknown) => {
    logger.debug("[EndSession] final extraction failed", { error });
  });

  if (options.reason === "exit") {
    await Promise.race([
      flushing,
      new Promise<void>((resolve) => {
        const t = setTimeout(resolve, EXIT_FLUSH_BUDGET_MS);
        t.unref?.();
      }),
    ]);
  }
}
