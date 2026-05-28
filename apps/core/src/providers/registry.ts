import { AIProvider, ProviderInfo } from './types'
import { ProviderId } from './config'

export interface ProviderDefinition {
  info: ProviderInfo
  create(apiKey: string): AIProvider
}

const registry = new Map<ProviderId, ProviderDefinition>()

export function registerProvider(id: ProviderId, def: ProviderDefinition): void {
  registry.set(id, def)
}

export function getProvider(id: ProviderId): AIProvider {
  const def = registry.get(id)
  if (!def) {
    const available = Array.from(registry.keys()).join(', ')
    throw new Error(`Provider "${id}" not registered. Available: ${available}`)
  }
  return def.create("")
}

export function listProviders(): ProviderInfo[] {
  return Array.from(registry.values()).map(def => def.info)
}

export function initProviders(): void {
  // Providers self-register
  // Import each to trigger registerProvider() call
  // Lazy import to avoid circular deps
  void import('./anthropic')
  void import('./openai')
  void import('./gemini')
  void import('./minimax')
}
