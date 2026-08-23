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
