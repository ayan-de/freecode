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
import { disposeAgentsForRoot } from "../agent/registry/index.js";
import { resetExtractPolicy } from "../memory/extract-policy.js";
import { disposeOutputStore } from "../tools/output-store/index.js";
import { disposeShellRegistry } from "../tools/shells/index.js";
import { disposeReadState } from "../tools/read-state.js";
import { disposePruneState } from "../agent/prune-state.js";
import { disposeCacheAwareness } from "../providers/cache-awareness.js";
import { disposeFrozenSessionContext } from "../context/session-context.js";
import { clearInvalidations } from "../providers/cache-invalidation.js";
import { logger } from "../utils/logger.js";
import { envInt } from "../utils/env.js";

export type SessionEndReason =
  | "switch"
  | "archive"
  | "stop"
  | "delete"
  | "exit";

// A process that is leaving cannot fire-and-forget: give the flush a bounded
// moment to land, then go regardless. Everything else stays non-blocking.
// The flush is a full model round trip, so 2s lost it on the most common end
// (quit); 5s catches most calls while keeping quit tolerable. Overridable for
// installs that would rather wait (or not wait at all — 0 skips the wait).
// 0 is a documented setting (skip the wait), which is why an EMPTY variable
// must not read as one: `Number("")` is 0, so exporting this empty used to mean
// "never wait for the final memory flush" rather than "not configured".
const EXIT_FLUSH_BUDGET_MS = envInt("FREECODE_EXIT_FLUSH_BUDGET_MS", 5_000, {
  min: 0,
});

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
// forever. A session that becomes active again must be reviveSession()d, or
// its later turns are never flushed — "ended" is a statement about the past,
// not a permanent property of the id.
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

/**
 * A previously ended session became active again (switch back, resume). Undo
 * the ended mark so the session's *next* end runs the disposers and the flush
 * over the turns it is about to accumulate — without this, a preference stated
 * after the revival was silently lost (the exact failure D4 exists to prevent).
 */
export function reviveSession(sessionId: string): void {
  ended.delete(sessionId);
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
    // Kills any background shell the session started. Nothing a session
    // spawned may outlive it — a dev server left running would hold its port.
    ["shells", () => disposeShellRegistry(sessionId)],
    // Stops and forgets every subagent this session's tree spawned. Their own
    // shells are disposed by the agent tool as each one settles.
    ["agents", () => disposeAgentsForRoot(sessionId)],
    ["readState", () => disposeReadState(sessionId)],
    ["pruneState", () => disposePruneState(sessionId)],
    ["cacheAwareness", () => disposeCacheAwareness(sessionId)],
    ["sessionContext", () => disposeFrozenSessionContext(sessionId)],
    // The documented-invalidation journal and its static-prefix fingerprint.
    ["cacheInvalidation", () => clearInvalidations(sessionId)],
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
