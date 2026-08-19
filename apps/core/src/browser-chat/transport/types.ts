// =============================================================================
// Browser Chat — transport interface
//
// "How code gets into the page." Swappable: cdp.ts today, an extension later,
// both injecting the same bridge script. Site knowledge lives in sites/.
// Spec: docs/superpowers/specs/2026-08-19-browser-chat-provider.md
// =============================================================================

import type { SiteAdapter } from "../sites/types.js";

/** Opaque per-thread handle. One live tab, one conversation on the site. */
export interface ThreadHandle {
  readonly id: string;
  readonly site: SiteAdapter;
}

/** What the page's own network stream yields, after Node-side decoding. */
export type RawChunk =
  | { type: "delta"; text: string }
  | { type: "end" }
  /**
   * Proactive quota telemetry. claude.ai reports window utilisation on EVERY
   * message, so we know how close the account is to a limit long before one is
   * hit — no guessing from error text.
   */
  | {
      type: "quota";
      /** e.g. "5h", "7d" — the tightest window reported. */
      window: string;
      /** 0..1 */
      utilization: number;
      resetsAt?: number;
    }
  | {
      type: "limit";
      kind: "thread_full" | "rate_limited";
      detail: string;
      resetAt?: number;
    }
  | { type: "error"; message: string };

export interface BrowserTransport {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  isConnected(): boolean;
  /**
   * Open a chat thread on the given site. `newChat` asks for a fresh
   * conversation; the CDP transport always gets one (new tab), while the
   * extension transport otherwise reuses the tab the user has on screen.
   */
  openThread(
    site: SiteAdapter,
    opts?: { newChat?: boolean },
  ): Promise<ThreadHandle>;
  closeThread(handle: ThreadHandle): Promise<void>;
  /** Type + submit one message. Resolves once the request has been dispatched. */
  send(handle: ThreadHandle, text: string): Promise<void>;
  /** Chunks for the in-flight response, ending at the first `end` chunk. */
  receive(handle: ThreadHandle, signal?: AbortSignal): AsyncIterable<RawChunk>;
  /**
   * Inline shape check: was a request matching the adapter's patterns ever
   * observed? False after a turn means the site's endpoint moved, which is a
   * different failure from "the model said nothing".
   */
  sawCompletionRequest(handle: ThreadHandle): boolean;
}
