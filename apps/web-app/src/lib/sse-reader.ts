// =============================================================================
// Fetch-based SSE reader for the web-app.
//
// The browser EventSource API can't set custom request headers, which is
// non-negotiable for non-loopback binds that require a bearer token
// (spec §4.1). EventSource also can't tell us about the `id:` field on
// each event, which we need for resumable reconnect (spec §4.2).
//
// This reader uses fetch + ReadableStream to drive a real SSE parser.
// On disconnect it reconnects with the last id: it saw as Last-Event-ID,
// so the server replays the gap. Backoff is exponential with a hard
// ceiling so a network outage doesn't pin the phone awake at full CPU.
// =============================================================================

import { getConnection } from "./connection.js";

export interface SSEEvent {
  /** Wire payload (parsed JSON). */
  data: unknown;
  /** The id: field, when present. Drives Last-Event-ID on reconnect. */
  id?: string;
  /** SSE event name (defaults to "message"). */
  event?: string;
}

/** Optional lifecycle hooks. */
export interface SSEReaderOptions {
  /** Called after the reader has connected successfully. */
  onOpen?: () => void;
  /** Called after a clean disconnect, before the next reconnect attempt. */
  onClose?: () => void;
  /** Called for every reconnect failure with the next delay (ms). */
  onReconnectScheduled?: (delayMs: number, attempt: number) => void;
  /**
   * Initial reconnect delay. Doubles per attempt up to maxReconnectMs.
   * Default 500ms.
   */
  initialReconnectMs?: number;
  /** Maximum reconnect delay. Default 30s. */
  maxReconnectMs?: number;
  /**
   * Hard ceiling on reconnect attempts before giving up. Default 0
   * = unlimited (the typical SPA case — keep trying while the tab is
   * open).
   */
  maxAttempts?: number;
  /**
   * Override the resolved base URL. Defaults to the daemon origin the
   * rest of the SPA talks to (see lib/connection.ts).
   */
  baseUrl?: string;
}

export interface SSEController {
  /** Permanently stop the reader and refuse to reconnect. */
  close(): void;
  /**
   * Drop the current connection and reconnect immediately, resetting
   * backoff. Used when the platform tells us the network changed (cell
   * ↔ wifi handover), which TCP itself can take minutes to notice.
   * Resume is unaffected — the new request carries Last-Event-ID.
   */
  reconnectNow(): void;
}

/**
 * Connect to /events for the given session and invoke `onEvent` for every
 * wire event received. Returns a controller the caller can use to stop.
 *
 * The reader is robust to disconnects: a network blip or a backgrounded
 * tab that suspends fetch for several seconds will be transparently
 * resumed with the last id: sent as Last-Event-ID. The server either
 * replays the buffered events or sends a single `stream_gap` event
 * (spec §4.2) — both are surfaced through onEvent with no special-case
 * handling at the call site.
 */
export function openStreamReader(
  sessionId: string,
  token: string | null,
  onEvent: (event: SSEEvent) => void,
  options: SSEReaderOptions = {},
): SSEController {
  const baseUrl = options.baseUrl ?? getConnection().baseUrl;
  const initialMs = options.initialReconnectMs ?? 500;
  const maxMs = options.maxReconnectMs ?? 30_000;
  const maxAttempts = options.maxAttempts ?? 0;

  let stopped = false;
  let attempt = 0;
  let lastEventId: string | undefined;
  let controller: AbortController | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  const connect = async (): Promise<void> => {
    if (stopped) return;
    // Held locally as well as on `controller` so that a connect aborted
    // by reconnectNow() can't null out the *replacement* controller
    // when its own finally block runs a microtask later.
    const own = new AbortController();
    controller = own;
    try {
      const url = new URL(`${baseUrl}/events`);
      url.searchParams.set("sessionId", sessionId);
      const headers: Record<string, string> = {
        Accept: "text/event-stream",
      };
      if (token) headers.Authorization = `Bearer ${token}`;
      if (lastEventId !== undefined) headers["Last-Event-ID"] = lastEventId;

      const response = await fetch(url.toString(), {
        method: "GET",
        headers,
        signal: own.signal,
      });

      if (!response.ok) {
        // 401 / 403 / 5xx — backoff and retry. The token can't be fixed
        // by retrying alone; we still backoff to avoid hammering.
        throw new Error(`HTTP ${response.status}`);
      }
      if (!response.body) {
        throw new Error("No response body");
      }

      // Successful connect — reset attempt counter.
      attempt = 0;
      options.onOpen?.();

      const reader = response.body.getReader();
      const decoder = new TextDecoder("utf-8");
      let buffer = "";

      // Reusable per-frame state. SSE frames are separated by a blank
      // line; lines starting with `:` are comments (heartbeats).
      let currentEvent: SSEEvent = { data: undefined };
      let dataLines: string[] = [];

      const dispatchFrame = (): void => {
        if (dataLines.length === 0 && currentEvent.event === undefined && currentEvent.id === undefined) {
          // Empty comment-only frame — ignore.
          currentEvent = { data: undefined };
          return;
        }
        if (dataLines.length > 0) {
          // SSE multi-line data: lines are joined with \n. The server
          // always emits a single line, but be defensive.
          currentEvent.data = dataLines.join("\n");
        }
        onEvent(currentEvent);
        currentEvent = { data: undefined };
        dataLines = [];
      };

      // The reader loops on the underlying ReadableStream. decodeStream
      // may split mid-line on chunk boundaries, so we buffer and split
      // on \n ourselves.
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let nl = buffer.indexOf("\n");
        while (nl !== -1) {
          const line = buffer.slice(0, nl).replace(/\r$/, "");
          buffer = buffer.slice(nl + 1);

          if (line === "") {
            // End of frame.
            dispatchFrame();
          } else if (line.startsWith(":")) {
            // Comment — heartbeat or ": connected". Ignore.
          } else {
            const colon = line.indexOf(":");
            const field = colon === -1 ? line : line.slice(0, colon);
            const value = colon === -1 ? "" : line.slice(colon + 1).replace(/^ /, "");
            switch (field) {
              case "id":
                currentEvent.id = value;
                lastEventId = value;
                break;
              case "event":
                currentEvent.event = value;
                break;
              case "data":
                dataLines.push(value);
                break;
              // `retry:` is ignored — we control our own backoff.
            }
          }

          nl = buffer.indexOf("\n");
        }
      }
      // Stream ended without error — clean close.
      options.onClose?.();
    } catch (err) {
      if (stopped) return;
      // AbortError is expected when we call close().
      if (err instanceof DOMException && err.name === "AbortError") return;
      // Anything else: schedule a reconnect.
    } finally {
      if (controller === own) controller = null;
    }

    if (stopped) return;
    // A newer connect has already taken over (reconnectNow) — don't
    // stack a second reconnect on top of it.
    if (controller !== null) return;
    scheduleReconnect();
  };

  const scheduleReconnect = (): void => {
    if (stopped) return;
    if (maxAttempts > 0 && attempt >= maxAttempts) return;
    attempt++;
    const delay = Math.min(initialMs * 2 ** (attempt - 1), maxMs);
    options.onReconnectScheduled?.(delay, attempt);
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      void connect();
    }, delay);
  };

  // Kick off the first connect immediately. Subsequent retries go through
  // scheduleReconnect.
  void connect();

  return {
    close(): void {
      stopped = true;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      controller?.abort();
    },
    reconnectNow(): void {
      if (stopped) return;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      attempt = 0;
      // Aborting makes the in-flight connect() bail out through its
      // AbortError branch without scheduling its own reconnect, so we
      // own the next connect exclusively.
      controller?.abort();
      void connect();
    },
  };
}

