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

/**
 * May background subsystems spend this provider on calls the user did not ask
 * for? See `ProviderInfo.auxiliaryCalls`.
 *
 * Fails OPEN — an unregistered id, or one that never declares the flag, is
 * allowed. This gates politeness, not safety: a wrong `false` would silently
 * switch memory off for every provider, which is a far worse failure than one
 * extra request against a quota.
 */
export function allowsAuxiliaryCalls(id: ProviderId): boolean {
  return registry.get(id)?.info.auxiliaryCalls !== false;
}

/**
 * Does this provider need an API key? See `ProviderInfo.requiresApiKey`.
 * Defaults to true, including for ids we do not know: prompting for a key that
 * turns out to be unnecessary is recoverable, silently treating a provider as
 * ready when it is not is a confusing failure at first use.
 */
export function providerRequiresApiKey(id: ProviderId): boolean {
  return registry.get(id)?.info.requiresApiKey !== false;
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
    // Ask/review over a logged-in web session. Registration is metadata-only
    // and no network call happens until the provider is actually used, so one
    // nobody selects costs a single module import at startup.
    import("./gemini-web/index.js"),
    import("./minimax-web/index.js"),
  ]);
}
