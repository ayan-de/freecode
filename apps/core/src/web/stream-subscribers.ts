// =============================================================================
// Per-session SSE subscriber registry + resumable ring buffer.
//
// Owns the multi-subscriber fan-out for /events (spec §4.3) and the
// resumable ring buffer (spec §4.2). Each session has a record with a
// Set<Subscriber> and a StreamBuffer; both share lifetime and tear down
// together so a session can never retain a buffer with no subscribers or
// vice versa.
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
// Reconnect after a spurious prune is free: the client resubscribes with
// Last-Event-ID and replays the gap. Pruning too eagerly is cheap;
// pruning too late leaks. The design is biased accordingly.
// =============================================================================

import type { ServerResponse, IncomingMessage } from "http";
import { StreamBuffer } from "./stream-buffer.js";

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
  buffer: StreamBuffer;
}

const HEARTBEAT_MS = 15_000;
const IDLE_TIMEOUT_MS = 60_000;

const sessions = new Map<string, SessionRecord>();

/**
 * Result of replaying from a requested Last-Event-ID. Either we have all
 * the events (no gap) or the buffer has already evicted past the request
 * (gap). The wire layer turns a gap into a single `stream_gap` event so
 * the client can render an explicit "output lost" marker.
 */
export type ReplayResult =
  | { gap: false; from: number; to: number; events: unknown[] }
  | { gap: true; from: number; to: number };

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

/**
 * Per-session wire-event fan-out (spec §4.3). Every event is appended to
 * the ring buffer BEFORE fan-out, so all subscribers agree on a single
 * monotonic seq counter. The seq is emitted as SSE's native `id:` field
 * so the client can reconnect with Last-Event-ID.
 */
export function publishToSession(sessionId: string, wire: unknown): number {
  const rec = sessions.get(sessionId);
  if (!rec) return 0;
  // Append to the ring buffer first. Even if no subscribers are listening,
  // the buffer preserves the event for a future reconnect (within the
  // bounded window).
  const seq = rec.buffer.push(wire);
  if (rec.subscribers.size === 0) return seq;
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
      // id: line carries the SSE Last-Event-ID. The data: line is the
      // JSON-encoded event as before.
      const frame = `id: ${seq}\ndata: ${JSON.stringify(wire)}\n\n`;
      const ok = sub.res.write(frame);
      sub.lastWriteMs = Date.now();
      if (!ok) {
        sub.drop();
      }
    } catch {
      sub.drop();
    }
  }
  return seq;
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

/**
 * Replay events for a subscriber that reconnected with Last-Event-ID.
 * Returns the events to send BEFORE the live stream resumes, or a gap
 * marker if the requested id has already been evicted.
 *
 * If afterSeq is empty/undefined, returns an empty "no-op" result so the
 * live stream starts fresh.
 */
export function replayForSubscriber(
  sessionId: string,
  afterSeq: number | undefined,
): ReplayResult {
  const rec = sessions.get(sessionId);
  if (!rec) return { gap: false, from: 0, to: 0, events: [] };
  if (afterSeq === undefined || afterSeq < 0) {
    return { gap: false, from: 0, to: 0, events: [] };
  }
  return rec.buffer.replayFrom(afterSeq);
}

/** Number of live subscribers for a session — useful for diagnostics/tests. */
export function subscriberCount(sessionId: string): number {
  return sessions.get(sessionId)?.subscribers.size ?? 0;
}

/** The most recent seq assigned for this session, or 0 if no events yet. */
export function currentSeq(sessionId: string): number {
  return sessions.get(sessionId)?.buffer.currentSeq ?? 0;
}

/**
 * Send a one-shot replay to a freshly-connected subscriber. Writes the
 * Last-Event-ID-recovery frames to res directly (NOT through publishToSession's
 * seq'd fan-out) because the live stream hasn't been subscribed yet.
 *
 * Returns true if any frames were written (including a gap marker).
 */
export function replayToSubscriber(
  sessionId: string,
  res: ServerResponse,
  afterSeq: number | undefined,
): boolean {
  const result = replayForSubscriber(sessionId, afterSeq);
  if (result.gap) {
    // Send a single stream_gap wire event. We assign it a synthetic seq
    // so the client's stream-gap-rendering code can use the same id:
    // parsing it does for every other event.
    const seq = currentSeq(sessionId);
    const gap = {
      type: "stream_gap",
      from: result.from,
      to: result.to,
    };
    try {
      res.write(`id: ${seq}\ndata: ${JSON.stringify(gap)}\n\n`);
      return true;
    } catch {
      return false;
    }
  }
  if (result.events.length === 0) return false;
  // Walk events in order with their assigned seqs. The buffer's events
  // array starts at the seq immediately after `afterSeq`, and result.from
  // records that first seq.
  const seqStart = result.from;
  for (let i = 0; i < result.events.length; i++) {
    const seq = seqStart + i;
    try {
      res.write(
        `id: ${seq}\ndata: ${JSON.stringify(result.events[i])}\n\n`,
      );
    } catch {
      return true; // partial replay is fine; the live stream picks up
    }
  }
  return true;
}

/** Tear down a session's record entirely (e.g. session.delete). */
export function disposeSession(sessionId: string): void {
  const rec = sessions.get(sessionId);
  if (!rec) return;
  rec.subscribers.clear();
  rec.buffer.dispose();
  sessions.delete(sessionId);
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function getOrCreateSession(sessionId: string): SessionRecord {
  let rec = sessions.get(sessionId);
  if (!rec) {
    rec = {
      subscribers: new Set(),
      buffer: new StreamBuffer(sessionId),
    };
    sessions.set(sessionId, rec);
  }
  return rec;
}

function tearDownIfEmpty(sessionId: string): void {
  const rec = sessions.get(sessionId);
  if (!rec) return;
  if (rec.subscribers.size === 0) {
    rec.buffer.dispose();
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

// Tests can override the constants via re-export below.
export const STREAM_TIMINGS = Object.freeze({
  HEARTBEAT_MS,
  IDLE_TIMEOUT_MS,
});