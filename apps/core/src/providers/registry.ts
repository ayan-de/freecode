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

let initialized: Promise<void> | undefined;

/**
 * Registers every provider, once.
 *
 * Memoized rather than idempotent-by-luck: this is called from three
 * entrypoints (`server.ts`, `cli/commands/run.ts`, `eval/runner.ts`) and again
 * eagerly by `providers/index.ts` on import, and awaiting the same promise is
 * what makes "has registration finished?" answerable. Repeating the work was
 * harmless — `registerProvider` is a Map set — but a second caller could
 * previously observe a half-populated registry while the first was still
 * awaiting its dynamic imports.
 *
 * Not memoized on failure, so a transient import error does not permanently
 * leave the process with no providers.
 */
export function initProviders(): Promise<void> {
  if (!initialized) {
    initialized = registerAll().catch((err) => {
      initialized = undefined;
      throw err;
    });
  }
  return initialized;
}

async function registerAll(): Promise<void> {
  const { resolveCatalogue } = await import("./catalogue.js");
  const { createGenericProvider, providerInfoFor } = await import(
    "./generic-provider.js"
  );
  // Every provider models.dev names that freecode carries an SDK for — ~198 of
  // its 212. `providers.list` (server.ts) has always offered the full
  // models.dev list to the picker, so anything narrower here is what produced
  // `Provider "x" not registered` at send time on a provider the user was
  // invited to choose. Registration is metadata only: the SDK is imported and
  // the API key read on first request, so an unused provider costs nothing.
  for (const entry of resolveCatalogue()) {
    registerProvider(entry.id, {
      info: providerInfoFor(entry),
      create: () => createGenericProvider(entry),
    });
  }
  // Ask/review over a logged-in Gemini web session (see gemini-web/index.ts).
  // Not in models.dev's catalogue and never will be — registration is
  // metadata-only and the sidecar is only contacted on first use, so a
  // provider nobody selects costs one module import at startup.
  await import("./gemini-web/index.js");
}
