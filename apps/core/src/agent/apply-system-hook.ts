// =============================================================================
// Apply a UserPromptSubmit rewrite without collapsing the static/session split.
//
// The loop builds system blocks as:
//   [static… cache:true] + [session… cache:false]
//
// The old path joined them, let the hook rewrite the string, then stuffed the
// whole result into one `{ cache: true }` block. That put todos / memory /
// reminders under the cache breakpoint — exactly the churn the static/dynamic
// split exists to avoid.
//
// Rules:
//   1. No rewrite → keep the original blocks (and their cache flags).
//   2. Rewrite still starts with the static text → keep static blocks cached;
//      everything after becomes one uncached session block.
//   3. Opaque rewrite → single uncached block. Paying full price once is
//      cheaper than poisoning the prefix every turn.
// =============================================================================

export interface CacheableBlock {
  text: string;
  cache: boolean;
}

export function applySystemPromptHookRewrite(
  systemBlocks: readonly CacheableBlock[],
  sessionBlocks: readonly CacheableBlock[],
  modifiedPrompt: string | undefined,
): CacheableBlock[] {
  const blocks = [...systemBlocks, ...sessionBlocks];
  if (modifiedPrompt === undefined) return blocks;

  const joined = blocks.map((b) => b.text).join("\n\n");
  if (modifiedPrompt === joined) return blocks;

  const staticText = systemBlocks.map((b) => b.text).join("\n\n");
  if (staticText.length > 0 && modifiedPrompt.startsWith(staticText)) {
    const after = modifiedPrompt.slice(staticText.length).replace(/^\n+/, "");
    return [
      ...systemBlocks,
      ...(after.length > 0 ? [{ text: after, cache: false }] : []),
    ];
  }

  return [{ text: modifiedPrompt, cache: false }];
}
