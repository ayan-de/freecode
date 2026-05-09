import { listProviders, type ProviderDefinition } from '../../lib/browser/providers/index.js';
import { logger } from '../../lib/utils/logger.js';

export interface SelectedProvider {
  id: string;
  name: string;
  definition: ProviderDefinition;
}

export function selectProvider(providerId?: string): SelectedProvider | null {
  const providers = listProviders();

  if (providers.length === 0) {
    logger.error('No providers registered');
    return null;
  }

  if (providerId) {
    const found = providers.find(p => p.id === providerId);
    if (found) {
      return { id: found.id, name: found.name, definition: found };
    }
    logger.warn(`Provider ${providerId} not found, using default`);
  }

  const defaultProvider = providers[0];
  return { id: defaultProvider.id, name: defaultProvider.name, definition: defaultProvider };
}

export function formatProviderList(): string {
  const providers = listProviders();
  return providers.map(p => `- **${p.id}** - ${p.name}`).join('\n');
}