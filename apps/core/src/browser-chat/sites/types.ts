// =============================================================================
// Browser Chat — site adapter interface
//
// "What to do on a site." This is the layer that churns when a site redesigns;
// the transport underneath it does not. Selectors are candidate LISTS: the
// first one that matches wins, so a redesign that renames one attribute does
// not necessarily break the adapter, and `browser doctor` can report exactly
// which candidate matched.
// =============================================================================

import type { RawChunk } from "../transport/types.js";
import type { SiteId } from "../types.js";
import type { SseFrame } from "./sse.js";

export interface SiteAdapter {
  readonly id: SiteId;
  readonly label: string;
  /** Bumped whenever selectors or frame decoding change; shown by `doctor`. */
  readonly adapterVersion: string;

  /** Where a brand-new conversation starts. */
  newChatUrl(): string;

  /**
   * Substrings identifying the completion request. Matched in-page by the
   * bridge script, so it must stay a plain serializable list.
   */
  readonly completionUrlPatterns: string[];

  /** Tried in order; first match wins. */
  readonly composerSelectors: string[];
  readonly submitSelectors: string[];

  /** One decoded SSE frame → a chunk, or null to ignore it. */
  decodeFrame(frame: SseFrame): RawChunk | null;
}
