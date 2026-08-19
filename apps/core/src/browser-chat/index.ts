// =============================================================================
// Browser Chat — registration
//
// The ONLY module core imports. Registration is metadata-only: this file, and
// everything it imports at module scope, must stay free of Playwright and the
// transport. initProviders() runs on every cold start, so a top-level transport
// import here would put the browser stack into the startup path of every
// session whether or not browser mode is ever used.
//
// Spec: docs/superpowers/specs/2026-08-19-browser-chat-provider.md
// =============================================================================

import { registerProvider } from "../providers/registry.js";
import type {
  AIProvider,
  ExecuteOptions,
  ExecuteResult,
  ProviderChunk,
} from "../providers/types.js";
import { SITE_IDS, buildProviderInfo, providerIdFor } from "./info.js";
import type { SiteId } from "./types.js";

// Memoized at MODULE scope, deliberately not per proxy: getProvider() calls
// create() on every lookup (registry.ts:24), so per-proxy state would mean a
// fresh provider — and eventually a fresh browser tab — for every call.
const instances = new Map<SiteId, Promise<AIProvider>>();

function load(site: SiteId): Promise<AIProvider> {
  let pending = instances.get(site);
  if (!pending) {
    // The one dynamic import that pulls in the transport. Keeping it out of
    // module scope is the whole point of this file.
    pending = import("./provider.js").then((m) =>
      m.createBrowserChatProvider(site, buildProviderInfo(site)),
    );
    // A failed load (e.g. playwright not installed) must not be cached
    // forever — drop it so a later attempt can retry after the user installs.
    pending.catch(() => instances.delete(site));
    instances.set(site, pending);
  }
  return pending;
}

/**
 * A stand-in that carries the static metadata and defers everything else.
 * Cheap to construct, which matters because create() runs per getProvider().
 */
function lazyProvider(site: SiteId): AIProvider {
  return {
    info: buildProviderInfo(site),
    execute: async (opts: ExecuteOptions): Promise<ExecuteResult> =>
      (await load(site)).execute(opts),
    stream: async function* (
      opts: ExecuteOptions,
    ): AsyncGenerator<ProviderChunk> {
      const provider = await load(site);
      if (!provider.stream) {
        throw new Error(`browser:${site} does not support streaming`);
      }
      yield* provider.stream(opts);
    },
  };
}

// Register on module load, matching every other provider in providers/.
for (const site of SITE_IDS) {
  registerProvider(providerIdFor(site), {
    info: buildProviderInfo(site),
    create: () => lazyProvider(site),
  });
}
