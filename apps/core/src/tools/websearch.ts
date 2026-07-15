// =============================================================================
// WebSearch Tool - Web search over plain HTTP
// Default provider: DuckDuckGo HTML endpoint (keyless).
// Optional: set BRAVE_API_KEY to use the Brave Search API instead.
// =============================================================================

import type { ToolContext } from "./types.js";
import type { Tool, ToolExecutionResult, JsonSchema } from "./tool.types.js";
import { buildTool, defaultToolUI } from "./factory.js";
import { websearchToolUI } from "./websearch/ui.js";
import { searchBrave, searchDuckDuckGo, type SearchResult } from "./websearch/providers.js";

const DEFAULT_COUNT = 8;
const MAX_COUNT = 20;

interface WebSearchParams {
  query: string;
  count?: number;
}

const websearchSchema: JsonSchema = {
  type: "object",
  properties: {
    query: { description: "The search query" },
    count: {
      description: `Number of results to return (default ${DEFAULT_COUNT}, max ${MAX_COUNT})`,
      type: "number",
    },
  },
  required: ["query"],
};

function validateWebSearchInput(
  params: unknown,
): { valid: true } | { valid: false; error: string } {
  if (!params || typeof params !== "object") {
    return { valid: false, error: "Expected object parameters" };
  }
  const p = params as Record<string, unknown>;
  if (typeof p.query !== "string" || p.query.trim().length === 0) {
    return { valid: false, error: "query is required and must be a non-empty string" };
  }
  return { valid: true };
}

function formatResults(query: string, results: SearchResult[]): string {
  if (results.length === 0) {
    return `No results found for "${query}".`;
  }
  return results
    .map((r, i) => {
      const parts = [`${i + 1}. ${r.title}`, `   ${r.url}`];
      if (r.snippet) parts.push(`   ${r.snippet}`);
      return parts.join("\n");
    })
    .join("\n\n");
}

async function executeWebSearch(
  params: WebSearchParams,
  ctx: ToolContext,
): Promise<
  ToolExecutionResult<{
    title: string;
    output: string;
    metadata?: Record<string, unknown>;
  }>
> {
  const count = Math.min(params.count ?? DEFAULT_COUNT, MAX_COUNT);
  const useBrave = !!process.env.BRAVE_API_KEY;
  const provider = useBrave ? "brave" : "duckduckgo";

  try {
    const results = useBrave
      ? await searchBrave(params.query, count, ctx.abort)
      : await searchDuckDuckGo(params.query, count, ctx.abort);

    return {
      success: true,
      result: {
        title: `Web search: ${params.query}`,
        output: formatResults(params.query, results),
        metadata: { provider, query: params.query, count: results.length },
      },
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export const WebSearchTool: Tool<WebSearchParams> = buildTool({
  id: "websearch",
  description:
    "Search the web and return a ranked list of results (title, URL, snippet). Uses DuckDuckGo by default, or the Brave Search API when BRAVE_API_KEY is set.",
  schemas: { parameters: websearchSchema },
  permissions: { operations: ["network"] },
  behavior: {
    isConcurrencySafe: true,
    isDestructive: false,
    userFacingName: "WebSearch",
  },
  ui: { ...defaultToolUI, ...websearchToolUI },
  execute: executeWebSearch,
  validateInput: validateWebSearchInput,
  isSearchOrReadCommand: () => ({ isSearch: true, isRead: false }),
});
