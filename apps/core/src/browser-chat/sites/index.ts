// =============================================================================
// Browser Chat — site adapter registry
// =============================================================================

import type { SiteId } from "../types.js";
import type { SiteAdapter } from "./types.js";
import { claudeAdapter } from "./claude.js";

const ADAPTERS: Partial<Record<SiteId, SiteAdapter>> = {
  claude: claudeAdapter,
};

export function getSiteAdapter(site: SiteId): SiteAdapter {
  const adapter = ADAPTERS[site];
  if (!adapter) {
    throw new Error(
      `No site adapter for "${site}" yet. claude.ai is the Phase 1 target; ` +
        `chatgpt.com lands in Phase 5.`,
    );
  }
  return adapter;
}

export function listSiteAdapters(): SiteAdapter[] {
  return Object.values(ADAPTERS).filter((a): a is SiteAdapter => Boolean(a));
}
