// =============================================================================
// Per-session ring buffer for resumable SSE (spec §4.2).
//
// - Events are appended with a monotonic per-session seq assigned at the
//   single emit point (publishToSession), so all subscribers agree on
//   numbering.
// - Bounded by BOTH count and bytes. The count bound guards against
//   pathological high-frequency emissions; the bytes bound guards against a
//   single huge tool_output (e.g. verbose build) pinning memory.
// - On reconnect with Last-Event-ID, the server replays events with seq
//   greater than the requested id. If the requested id is older than the
//   oldest seq still in the buffer, the server emits a `stream_gap` event
//   that the client renders as an explicit "output lost" marker — a
//   visible gap is recoverable; an invisible gap makes the transcript
//   quietly wrong.
//
// The buffer lives in stream-subscribers per session and shares its
// lifetime. Buffers are dropped when the session ends (in-memory only —
// a daemon restart legitimately loses them, and the client resyncs via
// session.resume).
// =============================================================================

/** Reasonable upper bound for a single event — a 1MB tool_output is large. */
const MAX_EVENT_BYTES = 1 * 1024 * 1024;

interface BufferEntry {
  seq: number;
  bytes: number;
  event: unknown;
}

export interface StreamBufferOptions {
  /** Max events kept. */
  maxEvents?: number;
  /** Max cumulative bytes kept. */
  maxBytes?: number;
}

export const STREAM_BUFFER_LIMITS = Object.freeze({
  DEFAULT_MAX_EVENTS: 1000,
  DEFAULT_MAX_BYTES: 4 * 1024 * 1024,
});

export class StreamBuffer {
  private buffer: BufferEntry[] = [];
  private totalBytes = 0;
  private nextSeq = 1;
  private readonly maxEvents: number;
  private readonly maxBytes: number;

  constructor(private readonly sessionId: string, opts: StreamBufferOptions = {}) {
    this.maxEvents = opts.maxEvents ?? STREAM_BUFFER_LIMITS.DEFAULT_MAX_EVENTS;
    this.maxBytes = opts.maxBytes ?? STREAM_BUFFER_LIMITS.DEFAULT_MAX_BYTES;
  }

  /** Current seq (the seq of the last pushed event, or 0 if empty). */
  get currentSeq(): number {
    return this.nextSeq - 1;
  }

  /** Append, returning the assigned seq. */
  push(event: unknown): number {
    const seq = this.nextSeq++;
    const bytes = byteSize(event);
    // Cap at per-event ceiling so a single 100MB tool_output does not
    // evict the entire buffer in one hit. We still keep the event — the
    // cap is on the *retained* total, not what we accept.
    const cappedBytes = Math.min(bytes, MAX_EVENT_BYTES);
    this.buffer.push({ seq, bytes: cappedBytes, event });
    this.totalBytes += cappedBytes;
    this.evict();
    return seq;
  }

  /**
   * Return events with seq > afterSeq, in order.
   *
   * If afterSeq is older than the oldest event in the buffer, returns
   * `{ gap: true, from, to }` so the caller can emit a stream_gap wire
   * event instead of silently skipping.
   */
  replayFrom(
    afterSeq: number,
  ):
    | { gap: false; from: number; to: number; events: unknown[] }
    | { gap: true; from: number; to: number } {
    if (this.buffer.length === 0) {
      // Nothing buffered yet. Treat as "you're up to date" — no gap.
      return { gap: false, from: afterSeq, to: afterSeq, events: [] };
    }
    const oldest = this.buffer[0].seq;
    if (afterSeq < oldest - 1) {
      // The requested id is older than what we have. The actual gap runs
      // from afterSeq+1 to oldest-1 (events that left the buffer).
      return { gap: true, from: afterSeq + 1, to: oldest - 1 };
    }
    // Walk from the start until we pass afterSeq.
    const events: unknown[] = [];
    let first = -1;
    let last = -1;
    for (const entry of this.buffer) {
      if (entry.seq > afterSeq) {
        if (first === -1) first = entry.seq;
        last = entry.seq;
        events.push(entry.event);
      }
    }
    if (first === -1) {
      // afterSeq is at or past the head — no replay needed.
      return { gap: false, from: afterSeq, to: afterSeq, events: [] };
    }
    return { gap: false, from: first, to: last, events };
  }

  /** Drop the buffer for this session. */
  dispose(): void {
    this.buffer = [];
    this.totalBytes = 0;
  }

  // -------------------------------------------------------------------------
  // Internal
  // -------------------------------------------------------------------------

  private evict(): void {
    // Drop from the front until both bounds are satisfied. We don't try
    // to be clever about partial-eviction — keeping the math simple is
    // worth more than squeezing a few extra events in.
    while (
      this.buffer.length > this.maxEvents ||
      this.totalBytes > this.maxBytes
    ) {
      const dropped = this.buffer.shift();
      if (!dropped) break;
      this.totalBytes -= dropped.bytes;
    }
  }
}

// ---------------------------------------------------------------------------
// Byte-size estimation. JSON.stringify is the cheapest approximation that
// catches the common case (a single huge tool_output). For pathological
// inputs (circular references, BigInts) we'd throw, but a wire event is
// always a plain string-only object — the bridge already filters the
// rich typed objects down to StreamEvent shapes.
// ---------------------------------------------------------------------------

function byteSize(event: unknown): number {
  try {
    return JSON.stringify(event).length;
  } catch {
    // Fallback: assume it would fit. The buffer's bit bound is a soft
    // cap; underestimating for a non-stringifiable event is acceptable.
    return 0;
  }
}
