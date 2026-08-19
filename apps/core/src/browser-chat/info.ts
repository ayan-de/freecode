// =============================================================================
// Browser Chat — provider metadata
//
// Static only. This module must stay free of Playwright and transport imports:
// it is loaded during initProviders() on every cold start.
// =============================================================================

import type { ProviderInfo } from "../providers/types.js";
import type { SiteId } from "./types.js";

const SITE_NAMES: Record<SiteId, string> = {
  claude: "Claude (browser)",
  chatgpt: "ChatGPT (browser)",
};

export const SITE_IDS: SiteId[] = ["claude", "chatgpt"];

export function providerIdFor(site: SiteId): string {
  return `browser:${site}`;
}

export function buildProviderInfo(site: SiteId): ProviderInfo {
  return {
    id: providerIdFor(site),
    name: SITE_NAMES[site],
    // The active model is whatever the site's own UI has selected. Driving that
    // picker is out of scope for v1.
    defaultModel: "site-default",
    // True: deltas come from the page's own network stream (spec, Architecture).
    supportsStreaming: true,
    // True at the interface level — the provider returns real toolCalls[]. That
    // they are emulated over a text protocol is an implementation detail the
    // agent loop must not see.
    supportsTools: true,
    // Advisory placeholder. We cannot cap the site's output, and browser mode
    // inverts the compaction trigger anyway (spec, Phase 3), so nothing should
    // budget against this the way it does for an API provider.
    maxOutputTokens: 8192,
    // The site owns the conversation. Continuation is driven by limits/meter.ts
    // rolling to a new chat, not by local token accounting.
    remoteContext: true,
  };
}
