// =============================================================================
// Read Tool - Read file contents with UI rendering
// =============================================================================

import * as fs from "fs";
import * as path from "path";
import type { ToolContext } from "./types.js";
import type { Tool, ToolExecutionResult, JsonSchema } from "./tool.types.js";
import { buildTool } from "./factory.js";
import { getReadState, canDedup } from "./read-state.js";
import { coerceNumber, coerceBoolean, isPositiveInt } from "./coerce-args.js";

interface ReadParams {
  filePath: string;
  offset?: number;
  limit?: number;
  asImage?: boolean;
}

const DEFAULT_LIMIT = 2000;
const MAX_LINE_LENGTH = 2000;
const MAX_LINE_SUFFIX = `... (line truncated to ${MAX_LINE_LENGTH} chars)`;
const MAX_BYTES = 50 * 1024;
const MAX_BYTES_LABEL = `${MAX_BYTES / 1024} KB`;
// OOM backstop for the whole-file reads below (the binary sniff and readLines
// both load the file). Matches the image branch's limit. Deliberately far above
// any real source file: the 50 KB byte cap is what controls output size, this
// only stops `read` on a multi-gigabyte log from taking the daemon down.
const MAX_FILE_BYTES = 10 * 1024 * 1024;

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

// Both caps are enforced here rather than reported after the fact: a single
// minified line can be larger than the whole byte budget, and slicing it later
// (adaptiveTruncate cuts on a character index) lands mid-line and mid-token.
//
// `cut` means the byte cap stopped the read — it is what the "capped at 50 KB"
// notice is keyed off, so it must not also mean "you asked for `limit` lines and
// got them", which is the ordinary case for any file of 2000+ lines.
function readLines(
  filepath: string,
  opts: { limit: number; offset: number },
): { raw: string[]; count: number; cut: boolean; more: boolean } {
  const allLines = fs.readFileSync(filepath, "utf-8").split("\n");
  const count = allLines.length;
  const start = opts.offset - 1;

  const raw: string[] = [];
  let bytes = 0;
  let cut = false;

  for (let i = start; i < count && raw.length < opts.limit; i++) {
    const line =
      allLines[i].length > MAX_LINE_LENGTH
        ? allLines[i].slice(0, MAX_LINE_LENGTH) + MAX_LINE_SUFFIX
        : allLines[i];
    // +1 for the newline this line will be joined with, except the first.
    const size = Buffer.byteLength(line, "utf-8") + (raw.length > 0 ? 1 : 0);
    if (bytes + size > MAX_BYTES) {
      cut = true;
      break;
    }
    raw.push(line);
    bytes += size;
  }

  return { raw, count, cut, more: cut || start + raw.length < count };
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
      description:
        "The line number to start reading from (1-indexed). Provide this whenever " +
        "you already know roughly where to look — from a grep hit, a stack trace, " +
        "or an earlier read. Reading 60 lines around a known line costs a fraction " +
        "of the whole file.",
    },
    limit: {
      type: "number",
      description:
        "The maximum number of lines to read (defaults to 2000, which is the whole " +
        "file for most sources). Pair with offset to read one region.",
    },
    asImage: {
      type: "boolean",
      description:
        "Read the file as an image so the model can see it. Use for screenshots, diagrams, or design files. Supports .png/.jpg/.jpeg/.gif/.webp — not SVG (read those as text).",
    },
  },
  required: ["filePath"],
};

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
  // Both are 1-based counts, so 0, negatives and fractions are always a mistake.
  // Rejecting with the reason beats silently clamping: the model that sent
  // offset=0 believed it was reading from the top and would not notice.
  if (p.offset !== undefined && !isPositiveInt(p.offset)) {
    return {
      valid: false,
      error: "offset must be a whole number >= 1 (the first line is line 1)",
    };
  }
  if (p.limit !== undefined && !isPositiveInt(p.limit)) {
    return {
      valid: false,
      error: "limit must be a whole number >= 1",
    };
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

    if (stat.size > MAX_FILE_BYTES) {
      return {
        success: false,
        error: `Error: File is too large (${(stat.size / 1024 / 1024).toFixed(1)}MB). Maximum size is ${MAX_FILE_BYTES / 1024 / 1024}MB. Use grep to search it instead.`,
      };
    }

    const sample = fs.readFileSync(filepath);
    if (isBinaryFile(sample)) {
      return {
        success: false,
        error: `Cannot read binary file: ${filepath}`,
      };
    }

    // Clamped as well as validated: execute is reachable without validateReadInput
    // (direct tool calls, tests), and a start line below 1 would index off the
    // front of the line array.
    const limit = Math.max(1, Math.trunc(coerceNumber(params.limit) ?? DEFAULT_LIMIT));
    const offset = Math.max(1, Math.trunc(coerceNumber(params.offset) ?? 1));

    // Re-reading a file the model was already shown, unchanged, costs the whole
    // file again on this turn and on every turn after it. Answer with a pointer
    // instead — but only when the earlier copy is genuinely still in the
    // request; see canDedup (RC5).
    const readState = ctx.sessionId ? getReadState(ctx.sessionId) : undefined;
    const current = {
      mtimeMs: stat.mtimeMs,
      size: stat.size,
      offset,
      limit,
    };
    if (readState && canDedup(readState.get(filepath), current)) {
      return {
        success: true,
        result: {
          title: path.basename(filepath),
          output:
            `<path>${filepath}</path>\n<type>file</type>\n` +
            `<unchanged>This file is byte-for-byte identical to the copy ` +
            `already shown earlier in this conversation — scroll up rather ` +
            `than re-reading. Edit it directly if that is what you need.` +
            `</unchanged>`,
          metadata: { deduped: true },
        },
      };
    }

    const lines = readLines(filepath, { limit, offset });

    let output = [
      `<path>${filepath}</path>`,
      `<type>file</type>`,
      "<content>\n",
    ].join("\n");
    // Per-line number prefixes are OFF by default: the D3 A/Bs (2026-09-04,
    // spec 2026-09-04-harness-cost-efficiency.md) measured -10.9%/-6.8% tokens
    // with pass rate and judged quality unchanged — edit is string-match, and
    // navigation numbers come from grep -n and LSP output.
    // FREECODE_READ_LINE_NUMBERS=1 restores them; read per call for `eval ab`.
    // The range footer below stays either way — offset paging needs no prefix.
    const numbered = process.env.FREECODE_READ_LINE_NUMBERS === "1";
    output += numbered
      ? lines.raw.map((line, i) => `${i + offset}: ${line}`).join("\n")
      : lines.raw.join("\n");

    const last = offset + lines.raw.length - 1;
    const next = last + 1;

    if (lines.raw.length === 0) {
      // An empty window is otherwise indistinguishable from an empty file, and
      // the footer below would claim "end of file" for a read that never started.
      output += `(No lines: offset ${offset} is past the end of this file, which has ${lines.count} lines.)`;
    } else if (lines.cut) {
      output += `\n\n(Output capped at ${MAX_BYTES_LABEL}. Showing lines ${offset}-${last}. Use offset=${next} to continue.)`;
    } else if (lines.more) {
      output += `\n\n(Showing lines ${offset}-${last} of ${lines.count}. Use offset=${next} to continue.)`;
    } else {
      output += `\n\n(End of file - total ${lines.count} lines)`;
    }
    output += "\n</content>";

    // Record what was shown, so an identical re-read can be deduped and so
    // `edit` can tell whether the file changed underneath the model.
    readState?.set(filepath, { ...current, inContext: true });

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
  description:
    "Read a file's contents. Defaults to the whole file, which is the expensive " +
    "option: the content stays in the conversation and is re-sent to the model on " +
    "every later request. When you already know the region you need, pass " +
    "offset/limit and read only that.",
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
  execute: executeRead,
  validateInput: validateReadInput,
  isSearchOrReadCommand: () => ({ isSearch: false, isRead: true }),
  getPath: (params) => params.filePath,
});
