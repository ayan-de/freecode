// =============================================================================
// WebFetch Tool - Fetch a URL and return its content as text/markdown/html
// PLAIN HTTP: uses global fetch (Node 18+), no browser, no external deps
// =============================================================================

import type { ToolContext } from "./types.js";
import type { Tool, ToolExecutionResult, JsonSchema } from "./tool.types.js";
import { buildTool, defaultToolUI } from "./factory.js";
import { webfetchToolUI } from "./webfetch/ui.js";
import { htmlToMarkdown, htmlToText } from "./webfetch/html.js";

const MAX_RESPONSE_SIZE = 5 * 1024 * 1024; // 5MB
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 120_000;

interface WebFetchParams {
  url: string;
  format?: "text" | "markdown" | "html";
  timeout?: number; // seconds
}

const webfetchSchema: JsonSchema = {
  type: "object",
  properties: {
    url: { description: "The URL to fetch content from (http:// or https://)" },
    format: {
      description:
        "Return format: 'text', 'markdown', or 'html'. Defaults to markdown.",
      enum: ["text", "markdown", "html"],
    },
    timeout: {
      description: "Optional timeout in seconds (max 120, default 30)",
      type: "number",
    },
  },
  required: ["url"],
};

function validateWebFetchInput(
  params: unknown,
): { valid: true } | { valid: false; error: string } {
  if (!params || typeof params !== "object") {
    return { valid: false, error: "Expected object parameters" };
  }
  const p = params as Record<string, unknown>;
  if (typeof p.url !== "string" || p.url.length === 0) {
    return { valid: false, error: "url is required and must be a string" };
  }
  if (!/^https?:\/\//.test(p.url)) {
    return { valid: false, error: "url must start with http:// or https://" };
  }
  return { valid: true };
}

async function executeWebFetch(
  params: WebFetchParams,
  ctx: ToolContext,
): Promise<
  ToolExecutionResult<{
    title: string;
    output: string;
    metadata?: Record<string, unknown>;
  }>
> {
  const format = params.format ?? "markdown";
  const timeoutMs = Math.min(
    (params.timeout ? params.timeout * 1000 : DEFAULT_TIMEOUT_MS),
    MAX_TIMEOUT_MS,
  );

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  if (ctx.abort) {
    ctx.abort.addEventListener("abort", () => controller.abort(), {
      once: true,
    });
  }

  try {
    const accept =
      format === "html"
        ? "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1"
        : format === "text"
          ? "text/plain;q=1.0,text/html;q=0.8,*/*;q=0.1"
          : "text/markdown;q=1.0,text/html;q=0.8,text/plain;q=0.7,*/*;q=0.1";

    const response = await fetch(params.url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; freecode/0.2; +https://github.com/ayan-de/freecode)",
        Accept: accept,
        "Accept-Language": "en-US,en;q=0.9",
      },
    });

    if (!response.ok) {
      return {
        success: false,
        error: `Request failed with status ${response.status} ${response.statusText}`,
      };
    }

    const contentLength = response.headers.get("content-length");
    if (contentLength && parseInt(contentLength, 10) > MAX_RESPONSE_SIZE) {
      return { success: false, error: "Response too large (exceeds 5MB limit)" };
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.byteLength > MAX_RESPONSE_SIZE) {
      return { success: false, error: "Response too large (exceeds 5MB limit)" };
    }

    const contentType = response.headers.get("content-type") ?? "";
    const isHtml = contentType.includes("text/html");
    const raw = buffer.toString("utf-8");
    const title = `${params.url} (${contentType || "unknown"})`;

    let output = raw;
    if (isHtml && format === "markdown") output = htmlToMarkdown(raw);
    else if (isHtml && format === "text") output = htmlToText(raw);

    return {
      success: true,
      result: {
        title,
        output,
        metadata: { url: params.url, format, contentType, bytes: buffer.byteLength },
      },
    };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return { success: false, error: `Request timed out after ${timeoutMs}ms` };
    }
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timer);
  }
}

export const WebFetchTool: Tool<WebFetchParams> = buildTool({
  id: "webfetch",
  description:
    "Fetch content from a URL over HTTP(S) and return it as markdown (default), plain text, or raw HTML",
  schemas: { parameters: webfetchSchema },
  permissions: { operations: ["network"] },
  behavior: {
    isConcurrencySafe: true,
    isDestructive: false,
    userFacingName: "WebFetch",
  },
  ui: { ...defaultToolUI, ...webfetchToolUI },
  execute: executeWebFetch,
  validateInput: validateWebFetchInput,
  isSearchOrReadCommand: () => ({ isSearch: false, isRead: true }),
});
