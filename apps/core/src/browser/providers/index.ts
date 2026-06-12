// =============================================================================
// Provider Registry
// =============================================================================

import type { PageAdapter, ProviderConfig } from "./types.js";
export type { PageAdapter, ProviderConfig } from "./types.js";

import { ChatGPTAdapter } from "./chatgpt.js";

export interface ProviderDefinition {
  id: string;
  name: string;
  adapter: PageAdapter;
  config: ProviderConfig;
}

const providers: Map<string, ProviderDefinition> = new Map();

export function registerProvider(definition: ProviderDefinition): void {
  providers.set(definition.id, definition);
}

export function getProvider(id: string): ProviderDefinition | undefined {
  return providers.get(id);
}

export function listProviders(): ProviderDefinition[] {
  return Array.from(providers.values());
}

export function createDefaultProviders(): void {
  registerProvider({
    id: "chatgpt",
    name: "ChatGPT",
    adapter: new ChatGPTAdapter(),
    config: {
      url: "https://chatgpt.com",
    },
  });
}
