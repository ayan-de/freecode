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
  ]);
}
