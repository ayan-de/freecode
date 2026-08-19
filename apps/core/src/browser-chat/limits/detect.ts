// =============================================================================
// Browser Chat — limit signal classification
//
// Turns a transport-level limit chunk into the decision the provider needs:
// can this turn be recovered by rolling to a new chat, or not?
// =============================================================================

import type { RawChunk } from "../transport/types.js";
import { RateLimitedError, ThreadFullError } from "./errors.js";

type LimitChunk = Extract<RawChunk, { type: "limit" }>;

export interface LimitDecision {
  /** True ⇒ open a new chat and replay the turn. */
  rollable: boolean;
  error: ThreadFullError | RateLimitedError;
}

export function classifyLimit(chunk: LimitChunk): LimitDecision {
  if (chunk.kind === "thread_full") {
    return { rollable: true, error: new ThreadFullError(chunk.detail) };
  }
  // A usage limit is not rollable: a new chat draws from the same quota, so
  // retrying would just burn another request against a wall.
  return {
    rollable: false,
    error: new RateLimitedError(chunk.detail, chunk.resetAt),
  };
}
