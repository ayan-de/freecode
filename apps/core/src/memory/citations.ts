// =============================================================================
// Memory citations (spec D12) — the read → write feedback loop.
//
// codex detects memory usage by watching the agent *read* memory files, which
// it can because its memories are fetched on demand. Ours are auto-injected
// into the system prompt, so there is no read to observe: the model has to tell
// us. It does so with a trailing tag, which we parse and strip.
//
// Self-reported use is a biased signal — a model may credit a memory it ignored,
// or use one silently. It is directional, and it is the only signal obtainable
// without a second model call. Nothing deletes a memory on this evidence alone
// (D9 still requires a merge target); it ranks and it retains.
// =============================================================================

const TAG = /<memory-used>([\s\S]*?)<\/memory-used>/gi;

export interface ParsedCitations {
  /** `type/name` ids the model claims to have used. Deduped, order preserved. */
  ids: string[];
  /** The reply with every tag removed, safe to show the user. */
  stripped: string;
}

/**
 * Pull `<memory-used>type/name, type/name</memory-used>` out of a reply.
 *
 * Tolerant on purpose: models wrap the tag in a code fence, add a trailing
 * period, or emit it more than once. None of that should cost a signal, and
 * none of it should leak into what the user reads.
 */
export function parseCitations(text: string): ParsedCitations {
  const ids: string[] = [];
  const seen = new Set<string>();

  for (const match of text.matchAll(TAG)) {
    for (const raw of (match[1] ?? "").split(",")) {
      // Trailing punctuation *and* the whitespace around it: models write
      // "project/a ." as readily as "project/a".
      const id = raw.trim().replace(/[.;\s]+$/, "");
      // Shape check only — whether the id names a real memory is the caller's
      // question, since only it knows what was injected.
      if (!/^[a-z]+\/[^\s/]+$/i.test(id)) continue;
      if (seen.has(id)) continue;
      seen.add(id);
      ids.push(id);
    }
  }

  return { ids, stripped: stripCitations(text) };
}

const OPEN = "<memory-used>";

/**
 * Streaming filter that keeps the citation tag off the user's screen.
 *
 * Stripping the *final* text is not enough: `text_delta` events reach the
 * frontend token by token, so by the time the full reply exists the tag has
 * already been rendered. Found by a real turn against a real provider — every
 * unit test passed while the tag was plainly visible in the output.
 *
 * The tag is instructed to come last, so the rule is simply "emit nothing from
 * the opening marker onward". The only subtlety is that the marker itself
 * arrives split across deltas, so any trailing text that could still *become*
 * the marker is held back until the next delta proves it either way.
 */
export class CitationStreamFilter {
  private held = "";
  private suppressing = false;

  /** Returns the text safe to show for this delta (often "" while deciding). */
  push(delta: string): string {
    if (this.suppressing) return "";

    const buffer = this.held + delta;
    const at = buffer.indexOf(OPEN);
    if (at !== -1) {
      this.suppressing = true;
      this.held = "";
      return buffer.slice(0, at);
    }

    // Hold back a suffix that is still a candidate prefix of the marker.
    const keep = partialMarkerLength(buffer);
    this.held = buffer.slice(buffer.length - keep);
    return buffer.slice(0, buffer.length - keep);
  }

  /** Anything held back that turned out not to be a tag. Call once at the end. */
  flush(): string {
    if (this.suppressing) return "";
    const rest = this.held;
    this.held = "";
    return rest;
  }
}

// Length of the longest suffix of `text` that is a proper prefix of the marker.
function partialMarkerLength(text: string): number {
  const max = Math.min(OPEN.length - 1, text.length);
  for (let n = max; n > 0; n--) {
    if (text.endsWith(OPEN.slice(0, n))) return n;
  }
  return 0;
}

/**
 * Remove citation tags from user-visible text.
 *
 * Also removes a code fence that exists only to hold a tag: models fence the
 * tag surprisingly often, and leaving an empty ```…``` behind is worse than the
 * tag itself. A fence with other content in it is left alone.
 */
export function stripCitations(text: string): string {
  return text
    .replace(/```[a-z]*\s*<memory-used>[\s\S]*?<\/memory-used>\s*```/gi, "")
    .replace(TAG, "")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}$/, "\n")
    .trimEnd();
}
