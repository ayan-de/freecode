// =============================================================================
// Browser Chat — streaming text filter
//
// Prose streams to the user as it arrives; the protocol block does not. Once a
// fence marker appears we stop emitting and buffer, because a half-written
// tool call rendered into the transcript is noise.
//
// A hold-back window covers the case where a fence marker is split across two
// network chunks — without it we would emit "~~" and then swallow "~freecode".
// =============================================================================

const FENCE_STARTS = ["~~~", "```", '{"calls"'];
const HOLD_BACK = Math.max(...FENCE_STARTS.map((s) => s.length)) - 1;

export interface StreamFilter {
  /** Text safe to show the user right now. */
  push(delta: string): string;
  /** Everything received, including the suppressed block. */
  full(): string;
  /** Any held-back text that turned out not to be a fence. */
  flush(): string;
}

export function createStreamFilter(): StreamFilter {
  let full = "";
  let emittedUpTo = 0;
  let suppressing = false;

  const fenceIndexFrom = (from: number): number => {
    let best = -1;
    for (const marker of FENCE_STARTS) {
      const at = full.indexOf(marker, from);
      if (at !== -1 && (best === -1 || at < best)) best = at;
    }
    return best;
  };

  return {
    push(delta: string): string {
      full += delta;
      if (suppressing) return "";

      const fenceAt = fenceIndexFrom(emittedUpTo);
      if (fenceAt !== -1) {
        suppressing = true;
        const out = full.slice(emittedUpTo, fenceAt);
        emittedUpTo = fenceAt;
        return out;
      }

      // Nothing looks like a fence yet, but the tail might be the start of one
      // that has not fully arrived. Hold it back.
      const safeEnd = Math.max(emittedUpTo, full.length - HOLD_BACK);
      if (safeEnd <= emittedUpTo) return "";
      const out = full.slice(emittedUpTo, safeEnd);
      emittedUpTo = safeEnd;
      return out;
    },

    full: () => full,

    flush(): string {
      if (suppressing || emittedUpTo >= full.length) return "";
      const out = full.slice(emittedUpTo);
      emittedUpTo = full.length;
      return out;
    },
  };
}
