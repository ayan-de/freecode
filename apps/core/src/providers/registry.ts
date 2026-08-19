import { AIProvider, ProviderInfo } from "./types.js";
import { ProviderId } from "./config.js";

export interface ProviderDefinition {
  info: ProviderInfo;
  create(apiKey: string): AIProvider;
}

const registry = new Map<ProviderId, ProviderDefinition>();

export function registerProvider(
  id: ProviderId,
  def: ProviderDefinition,
): void {
  registry.set(id, def);
}

export function getProvider(id: ProviderId): AIProvider {
  const def = registry.get(id);
  if (!def) {
    const available = Array.from(registry.keys()).join(", ");
    throw new Error(`Provider "${id}" not registered. Available: ${available}`);
  }
  return def.create("");
}

export function listProviders(): ProviderInfo[] {
  return Array.from(registry.values()).map((def) => def.info);
}

export async function initProviders(): Promise<void> {
  // Providers self-register via side effect when imported
  // Import each to trigger registerProvider() call
  // Use Promise.all to wait for all registrations to complete
  await Promise.all([
    import("./anthropic.js"),
    import("./openai.js"),
    import("./gemini.js"),
    import("./minimax.js"),
    import("./deepseek.js"),
    import("./zai.js"),
    // Optional add-on (spec 2026-08-19-browser-chat-provider.md). Registration
    // is metadata-only — the Playwright transport is imported lazily on first
    // use — so this costs nothing at startup. A missing module is not an
    // error: delete browser-chat/ and this line, and the feature is gone.
    import("../browser-chat/index.js").catch(() => {}),
  ]);
}
