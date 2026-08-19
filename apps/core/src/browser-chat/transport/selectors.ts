// =============================================================================
// Browser Chat — candidate selector resolution
//
// Adapters ship selector LISTS rather than single strings, so a redesign that
// renames one attribute does not necessarily break the adapter. Which
// candidate actually matched is reported by `browser doctor`.
// =============================================================================

import type { Locator, Page } from "playwright";

export interface SelectorMatch {
  locator: Locator;
  selector: string;
  /** Index into the candidate list — 0 means the preferred selector matched. */
  rank: number;
}

/**
 * First visible match wins. `timeoutMs` is the budget for the whole list, not
 * per candidate, so a long list cannot multiply the wait.
 */
export async function resolveFirst(
  page: Page,
  selectors: string[],
  timeoutMs = 15_000,
): Promise<SelectorMatch | null> {
  const deadline = Date.now() + timeoutMs;

  // One pass with a real wait on the preferred selector, then cheap polling
  // over the rest — the common case is that candidate 0 matches.
  while (Date.now() < deadline) {
    for (let rank = 0; rank < selectors.length; rank++) {
      const selector = selectors[rank];
      const locator = page.locator(selector).first();
      const visible = await locator.isVisible().catch(() => false);
      if (visible) return { locator, selector, rank };
    }
    await page.waitForTimeout(250);
  }
  return null;
}
