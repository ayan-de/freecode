// =============================================================================
// Context Strategies Registry
// =============================================================================

export { FileTreeStrategy } from './file-tree.js';

import type { ContextStrategy } from '../types.js';
import { FileTreeStrategy } from './file-tree.js';

const strategies: Map<string, ContextStrategy> = new Map();

export function registerStrategy(strategy: ContextStrategy): void {
  strategies.set(strategy.name, strategy);
}

export function getStrategy(name: string): ContextStrategy | undefined {
  return strategies.get(name);
}

export function createDefaultStrategies(): void {
  registerStrategy(new FileTreeStrategy());
}