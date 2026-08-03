// =============================================================================
// Per-session SSE subscriber registry.
//
// Owns the multi-subscriber fan-out for /events (spec §4.3). Each session has
// a record with a Set<Subscriber> and (Phase 2) a ring buffer; both share
// lifetime and tear down together so a session can never retain a buffer with
// no subscribers or vice versa.
//
// Liveness is established positively rather than inferred from silence:
//   - Periodic heartbeat (HEARTBEAT_MS) — a `: heartbeat` comment frame.
//     `res.write()` returning false (backpressure) or the socket being
//     destroyed drops the subscriber immediately.
//   - Explicit socket checks before every publish (res.socket.destroyed).
//   - Idle reaper — any subscriber whose last successful write is older than
//     IDLE_TIMEOUT_MS is dropped regardless. Backstop for half-open sockets
//     that never surface an error.
//   - close/error listeners on req and res for the clean cases.
//
// Reconnect after a spurious prune is free (Phase 2): the client resubscribes
// with Last-Event-ID and replays the gap. Pruning too eagerly is cheap;
// pruning too late leaks. The design is biased accordingly.
// =============================================================================

import type { ServerResponse, IncomingMessage } from "http";
import type { Socket } from "net";

// RingBuffer shape — implemented by the stream-buffer module added in Phase 2.
// Defined here as a structural interface so the two modules can share lifetime
// without a cycle.
export interface RingBufferLike {
  /** Append an event and return its assigned seq. */
  push(wire: unknown): number;
  /** Return a snapshot of events with seq > afterSeq, in order. */
  replayFrom(afterSeq: number): { from: number; to: number; events: unknown[] };
  /** True if afterSeq is older than the oldest event still in the buffer. */
  hasGap(afterSeq: number): boolean;
  /** Drop the buffer for this session — called on session end or last unsub. */
  dispose(): void;
}

export type WireCallback = (event: unknown) => void;

interface Subscriber {
  /** Bound at add time so we never reach into a destroyed res. */
  res: ServerResponse;
  req: IncomingMessage;
  /** Timestamp of the last *successful* write. Updated by publish(). */
  lastWriteMs: number;
  /** Bound in addSubscriber so the reaper can prune without a closure chase. */
  drop: () => void;
}

interface SessionRecord {
  subscribers: Set<Subscriber>;
  buffer: RingBufferLike | null;
  // Monotonic per-session seq counter (Phase 2 increments this; we keep the
  // counter here so Phase 1's fan-out and Phase 2's ring buffer share state).
  seq: number;
}

const HEARTBEAT_MS = 15_000;
const IDLE_TIMEOUT_MS = 60_000;

const sessions = new Map<string, SessionRecord>();

/**
 * Called by /events after a successful auth check. Registers a per-session
 * subscriber that receives every wire event emitted by the bus for this
 * session, and installs the close/error listeners needed to prune the
 * subscriber without relying on a clean socket close.
 *
 * The wire format `data: <json>\n\n` is owned by this module so callers
 * don't need to pass a writer. The reaper drops subscribers whose
 * res.write returns false or whose socket is destroyed; req/res listeners
 * catch the clean cases.
 */
export function addSubscriber(
  sessionId: string,
  req: IncomingMessage,
  res: ServerResponse,
): void {
  const rec = getOrCreateSession(sessionId);

  // Sentinel sentinels for the reaper. They're closures that delegate to the
  // bound `drop` function below, so a single Subscriber always has exactly
  // one removal path regardless of which listener fires.
  const drop = () => removeSubscriber(sessionId, sub);

  const sub: Subscriber = {
    res,
    req,
    lastWriteMs: Date.now(),
    drop,
  };

  rec.subscribers.add(sub);

  // Bind close/error on both directions. Either side closing means the
  // socket is gone for our purposes. We bind BEFORE writing anything because
  // a half-closed peer on a tunnel can fire close between the add() and the
  // first write.
  req.on("close", drop);
  req.on("error", drop);
  res.on("close", drop);
  res.on("error", drop);
}

/**
 * Called from a subscriber's drop() closure. Tolerated when the subscriber
 * is already gone (reaper may race with the close listener).
 */
export function removeSubscriber(sessionId: string, sub: Subscriber): void {
  const rec = sessions.get(sessionId);
  if (!rec) return;
  rec.subscribers.delete(sub);
  tearDownIfEmpty(sessionId);
}

/** Per-session wire-event fan-out (spec §4.3). */
export function publishToSession(sessionId: string, wire: unknown): void {
  const rec = sessions.get(sessionId);
  if (!rec || rec.subscribers.size === 0) return;
  // Iterate a snapshot — a failing write drops the subscriber, mutating the
  // set we're walking.
  for (const sub of [...rec.subscribers]) {
    if (sub.res.socket?.destroyed || sub.res.writableEnded) {
      sub.drop();
      continue;
    }
    try {
      // backpressure=false means we should back off, but for SSE a single
      // slow consumer should be dropped, not paused — pausing one would
      // stall every other subscriber on this session.
      const ok = sub.res.write(`data: ${JSON.stringify(wire)}\n\n`);
      sub.lastWriteMs = Date.now();
      if (!ok) {
        // Drop on backpressure rather than accumulate buffer. The client
        // can resubscribe with Last-Event-ID in Phase 2.
        sub.drop();
      }
    } catch {
      sub.drop();
    }
  }
}

/**
 * Broadcast to every attached subscriber of every session. Used for events
 * that aren't tied to a single sessionId (currently nothing in v1, but the
 * API matches what the old sessionEventCallbacks.values() path supported).
 */
export function publishToAll(wire: unknown): void {
  for (const sessionId of [...sessions.keys()]) {
    publishToSession(sessionId, wire);
  }
}

/** Number of live subscribers for a session — useful for diagnostics/tests. */
export function subscriberCount(sessionId: string): number {
  return sessions.get(sessionId)?.subscribers.size ?? 0;
}

/** Tear down a session's record entirely (e.g. session.delete). */
export function disposeSession(sessionId: string): void {
  const rec = sessions.get(sessionId);
  if (!rec) return;
  rec.subscribers.clear();
  rec.buffer?.dispose();
  sessions.delete(sessionId);
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function getOrCreateSession(sessionId: string): SessionRecord {
  let rec = sessions.get(sessionId);
  if (!rec) {
    rec = { subscribers: new Set(), buffer: null, seq: 0 };
    sessions.set(sessionId, rec);
  }
  return rec;
}

function tearDownIfEmpty(sessionId: string): void {
  const rec = sessions.get(sessionId);
  if (!rec) return;
  if (rec.subscribers.size === 0) {
    rec.buffer?.dispose();
    sessions.delete(sessionId);
  }
}

// ---------------------------------------------------------------------------
// Heartbeat + idle reaper — single global interval, scans every session.
//
// The interval is unref()'d so a dangling reaper never keeps the process
// alive on its own. That's important in the CLI bootstrap path where
// web-server may be started as a side feature.
// ---------------------------------------------------------------------------

const HEARTBEAT_FRAME = ": heartbeat\n\n";

function tick(): void {
  const now = Date.now();
  for (const sessionId of [...sessions.keys()]) {
    const rec = sessions.get(sessionId);
    if (!rec) continue;
    for (const sub of [...rec.subscribers]) {
      // Idle reaper — backstop for half-open sockets that never fire close.
      if (now - sub.lastWriteMs > IDLE_TIMEOUT_MS) {
        sub.drop();
        continue;
      }
      // Heartbeat. A failing write drops the subscriber immediately.
      if (sub.res.socket?.destroyed || sub.res.writableEnded) {
        sub.drop();
        continue;
      }
      try {
        const ok = sub.res.write(HEARTBEAT_FRAME);
        sub.lastWriteMs = Date.now();
        if (!ok) sub.drop();
      } catch {
        sub.drop();
      }
    }
  }
}

// One global reaper. Module-load starts it; process exit stops it.
const reaper = setInterval(tick, HEARTBEAT_MS);
reaper.unref?.();

// Belt-and-braces: the reaper is itself a no-op once the session map is
// empty, but we don't bother tracking that. setInterval with unref() is
// cheap enough at 15s.
//
// Tests can override the constants via re-export below.
export const STREAM_TIMINGS = Object.freeze({
  HEARTBEAT_MS,
  IDLE_TIMEOUT_MS,
});
