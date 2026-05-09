import { MarkdownExtractor } from './markdown.js';
import { JsonExtractor } from './json.js';
import { StructuredExtractor } from './structured.js';
import type { ParserStrategy } from '../types.js';

export { MarkdownExtractor, JsonExtractor, StructuredExtractor };

const extractors: Map<string, ParserStrategy> = new Map();

export function registerExtractor(extractor: ParserStrategy): void {
  extractors.set(extractor.name, extractor);
}

export function getExtractor(name: string): ParserStrategy | undefined {
  return extractors.get(name);
}

export function createDefaultExtractors(): void {
  registerExtractor(new MarkdownExtractor());
  registerExtractor(new JsonExtractor());
  registerExtractor(new StructuredExtractor());
}