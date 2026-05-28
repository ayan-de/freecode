// =============================================================================
// Parser Extractors Registry
// =============================================================================

export { StructuredExtractor } from './structured.js';
export { MarkdownExtractor } from './markdown.js';
export { JsonExtractor } from './json.js';

import type { ParserStrategy } from '../types.js';
import { StructuredExtractor } from './structured.js';
import { MarkdownExtractor } from './markdown.js';
import { JsonExtractor } from './json.js';

const extractors: Map<string, ParserStrategy> = new Map();

export function registerExtractor(extractor: ParserStrategy): void {
  extractors.set(extractor.name, extractor);
}

export function getExtractor(name: string): ParserStrategy | undefined {
  return extractors.get(name);
}

export function createDefaultExtractors(): void {
  registerExtractor(new StructuredExtractor());
  registerExtractor(new MarkdownExtractor());
  registerExtractor(new JsonExtractor());
}