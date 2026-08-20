// =============================================================================
// Browser Chat — site adapter registry
// =============================================================================

import type { SiteId } from "../types.js";
import type { SiteAdapter } from "./types.js";
import { claudeAdapter } from "./claude.js";
import { chatgptAdapter } from "./chatgpt.js";

const ADAPTERS: Partial<Record<SiteId, SiteAdapter>> = {
  claude: claudeAdapter,
  chatgpt: chatgptAdapter,
};

export function getSiteAdapter(site: SiteId): SiteAdapter {
  const adapter = ADAPTERS[site];
  if (!adapter) {
    throw new Error(`No site adapter for "${site}" yet.`);
  }
  return adapter;
}

export function listSiteAdapters(): SiteAdapter[] {
  return Object.values(ADAPTERS).filter((a): a is SiteAdapter => Boolean(a));
}
