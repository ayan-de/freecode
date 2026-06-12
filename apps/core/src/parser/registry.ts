// =============================================================================
// Parser Registry
// =============================================================================

import type { ParserResult } from "./types.js";
import { getExtractor, createDefaultExtractors } from "./extractors/index.js";
import { logger } from "../utils/logger.js";

createDefaultExtractors();

export interface ParserRegistryOptions {
  maxAttempts?: number;
}

export function parseWithStrategy(
  raw: string,
  strategyName: string,
): ParserResult {
  const extractor = getExtractor(strategyName);
  if (!extractor) {
    return { success: false, error: `Unknown strategy: ${strategyName}` };
  }

  const result = extractor.parse(raw);
  if (result.success) {
    logger.debug("Parsing succeeded", { strategy: strategyName });
  }
  return result;
}

export function parseWithChain(
  raw: string,
  strategies: string[],
): ParserResult {
  for (const strategy of strategies) {
    const result = parseWithStrategy(raw, strategy);
    if (result.success) {
      return result;
    }
  }

  return {
    success: false,
    error: "No parser succeeded",
  };
}

export const DEFAULT_PARSER_CHAIN = ["structured", "markdown", "json"];

export function parse(raw: string, chain = DEFAULT_PARSER_CHAIN): ParserResult {
  logger.debug("Parsing response", { chain });
  return parseWithChain(raw, chain);
}
