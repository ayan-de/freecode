// =============================================================================
// Read Tool - Read file contents with UI rendering
// =============================================================================

import * as fs from "fs";
import * as path from "path";
import type { ToolContext } from "./types.js";
import type { Tool, ToolExecutionResult, JsonSchema } from "./tool.types.js";
import { buildTool, defaultToolUI } from "./factory.js";
import { readToolUI } from "./read/ui.js";

interface ReadParams {
  filePath: string;
  offset?: number;
  limit?: number;
  asImage?: boolean;
}

const DEFAULT_LIMIT = 2000;
const MAX_LINE_LENGTH = 2000;
const MAX_BYTES = 50 * 1024;
const MAX_BYTES_LABEL = `${MAX_BYTES / 1024} KB`;

function isBinaryFile(bytes: Uint8Array): boolean {
  if (bytes.length === 0) return false;
  let nonPrintableCount = 0;
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] === 0) return true;
    if (bytes[i] < 9 || (bytes[i] > 13 && bytes[i] < 32)) {
      nonPrintableCount++;
    }
  }
  return nonPrintableCount / bytes.length > 0.3;
}

function readLines(
  filepath: string,
  opts: { limit: number; offset: number },
): { raw: string[]; count: number; cut: boolean; more: boolean } {
  const content = fs.readFileSync(filepath, "utf-8");
  const allLines = content.split("\n");
  const start = opts.offset - 1;
  const raw = allLines.slice(start, start + opts.limit);
  const count = allLines.length;
  const more = start + opts.limit < count;
  const cut = raw.join("\n").length > MAX_BYTES || raw.length >= opts.limit;

  return { raw, count, cut, more };
}

// =============================================================================
// Read Schema
// =============================================================================

const readSchema: JsonSchema = {
  type: "object",
  properties: {
    filePath: {
      type: "string",
      description: "The absolute path to the file or directory to read",
    },
    offset: {
      type: "number",
      description: "The line number to start reading from (1-indexed)",
    },
    limit: {
      type: "number",
      description: "The maximum number of lines to read (defaults to 2000)",
    },
    asImage: {
      type: "boolean",
      description:
        "Read the file as an image so the model can see it. Use for screenshots, diagrams, or design files. Supports .png/.jpg/.jpeg/.gif/.webp — not SVG (read those as text).",
    },
  },
  required: ["filePath"],
};

// Some providers (notably MiniMax via the Anthropic-compat endpoint) serialize
// numeric tool args as strings ("260"). Accept a number or a numeric string;
// return undefined for anything else so callers fall back to their default.
export function coerceNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

// Same story for booleans: "true"/"false" arrive as strings from the same
// providers, and `params.asImage === true` would silently read a PNG as text.
export function coerceBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const v = value.trim().toLowerCase();
    if (v === "true") return true;
    if (v === "false") return false;
  }
  return undefined;
}

// =============================================================================
// Input validation
// =============================================================================

function validateReadInput(
  params: unknown,
): { valid: true } | { valid: false; error: string } {
  if (!params || typeof params !== "object") {
    return { valid: false, error: "Expected object parameters" };
  }
  const p = params as Record<string, unknown>;
  if (typeof p.filePath !== "string" || p.filePath.length === 0) {
    return { valid: false, error: "filePath is required and must be a string" };
  }
  if (p.offset !== undefined && coerceNumber(p.offset) === undefined) {
    return { valid: false, error: "offset must be a number" };
  }
  if (p.limit !== undefined && coerceNumber(p.limit) === undefined) {
    return { valid: false, error: "limit must be a number" };
  }
  if (p.asImage !== undefined && coerceBoolean(p.asImage) === undefined) {
    return { valid: false, error: "asImage must be a boolean" };
  }
  return { valid: true };
}

// =============================================================================
// Execute function
// =============================================================================

async function executeRead(
  params: ReadParams,
  ctx: ToolContext,
): Promise<
  ToolExecutionResult<{
    title: string;
    output: string;
    metadata?: Record<string, unknown>;
  }>
> {
  try {
    let filepath = params.filePath;
    if (!path.isAbsolute(filepath)) {
      filepath = path.resolve(ctx.cwd, filepath);
    }

    const stat = fs.statSync(filepath);

    // Handle image reading
    if (coerceBoolean(params.asImage) === true) {
      if (stat.isDirectory()) {
        return {
          success: false,
          error: `Error: ${filepath} is a directory, not an image.`,
        };
      }
      // NOTE: SVG and BMP are NOT supported - vision APIs don't accept these formats
      const ext = path.extname(filepath).toLowerCase();
      const imageExtensions = [".png", ".jpg", ".jpeg", ".gif", ".webp"];

      if (!imageExtensions.includes(ext)) {
        return {
          success: false,
          error: `Error: ${ext} is not a supported image format. Supported: ${imageExtensions.join(", ")}. SVG and BMP files are not supported as images.`,
        };
      }

      try {
        const imageBuffer = fs.readFileSync(filepath);
        const fileSizeBytes = imageBuffer.length;
        const maxSizeBytes = 10 * 1024 * 1024; // 10MB limit

        if (fileSizeBytes > maxSizeBytes) {
          return {
            success: false,
            error: `Error: Image file is too large (${(fileSizeBytes / 1024 / 1024).toFixed(1)}MB). Maximum size is 10MB.`,
          };
        }

        const base64 = imageBuffer.toString("base64");
        const mediaType =
          ext === ".png"
            ? "image/png"
            : ext === ".gif"
              ? "image/gif"
              : ext === ".webp"
                ? "image/webp"
                : "image/jpeg";

        // The base64 never goes in `output` — that string is the tool result
        // the model reads as text, and re-sending megabytes of it every turn
        // would blow the context window. The loop lifts `metadata.image` into
        // an image message part instead; this line is just the receipt.
        const sizeKb = (fileSizeBytes / 1024).toFixed(1);
        return {
          success: true,
          result: {
            title: `${path.basename(filepath)} (image)`,
            output: `Attached ${path.basename(filepath)} (${mediaType}, ${sizeKb}KB) as an image.`,
            metadata: {
              image: {
                data: base64,
                mediaType,
                sizeBytes: fileSizeBytes,
              },
            },
          },
        };
      } catch (error) {
        return {
          success: false,
          error: `Error reading image: ${error}`,
        };
      }
    }

    if (stat.isDirectory()) {
      const items = fs.readdirSync(filepath).sort();
      const offset = params.offset || 1;
      const limit = params.limit ?? DEFAULT_LIMIT;
      const start = offset - 1;
      const sliced = items.slice(start, start + limit);
      const truncated = start + sliced.length < items.length;

      return {
        success: true,
        result: {
          title: path.basename(filepath),
          output: [
            `<path>${filepath}</path>`,
            `<type>directory</type>`,
            `<entries>`,
            sliced.join("\n"),
            truncated
              ? `\n(Showing ${sliced.length} of ${items.length} entries)`
              : `\n(${items.length} entries)`,
            `</entries>`,
          ].join("\n"),
          metadata: { truncated },
        },
      };
    }

    const sample = fs.readFileSync(filepath);
    if (isBinaryFile(sample)) {
      return {
        success: false,
        error: `Cannot read binary file: ${filepath}`,
      };
    }

    const limit = coerceNumber(params.limit) ?? DEFAULT_LIMIT;
    const offset = coerceNumber(params.offset) ?? 1;
    const lines = readLines(filepath, { limit, offset });

    let output = [
      `<path>${filepath}</path>`,
      `<type>file</type>`,
      "<content>\n",
    ].join("\n");
    output += lines.raw.map((line, i) => `${i + offset}: ${line}`).join("\n");

    const last = offset + lines.raw.length - 1;
    const next = last + 1;

    if (lines.cut) {
      output += `\n\n(Output capped at ${MAX_BYTES_LABEL}. Showing lines ${offset}-${last}. Use offset=${next} to continue.)`;
    } else if (lines.more) {
      output += `\n\n(Showing lines ${offset}-${last} of ${lines.count}. Use offset=${next} to continue.)`;
    } else {
      output += `\n\n(End of file - total ${lines.count} lines)`;
    }
    output += "\n</content>";

    return {
      success: true,
      result: {
        title: path.basename(filepath),
        output,
        metadata: { truncated: lines.cut || lines.more, lines: lines.count },
      },
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

// =============================================================================
// ReadTool - Built with buildTool() factory
// =============================================================================

export const ReadTool: Tool<ReadParams> = buildTool({
  id: "read",
  description: "Read file contents",
  schemas: {
    parameters: readSchema,
  },
  permissions: {
    operations: ["file.read"],
  },
  behavior: {
    isConcurrencySafe: true,
    isDestructive: false,
    userFacingName: "Read File",
  },
  ui: {
    ...defaultToolUI,
    ...readToolUI,
  },
  execute: executeRead,
  validateInput: validateReadInput,
  isSearchOrReadCommand: () => ({ isSearch: false, isRead: true }),
  getPath: (params) => params.filePath,
});
