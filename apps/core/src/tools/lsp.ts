// =============================================================================
// LSP Tool - Query a language server for diagnostics, hover, definition, or
// references. Uses a lean self-contained LSP client (tools/lsp/client.ts).
// Servers must be installed on the host; unsupported file types degrade
// gracefully with a clear message.
// =============================================================================

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import type { ToolContext } from "./types.js";
import type { Tool, ToolExecutionResult, JsonSchema } from "./tool.types.js";
import { buildTool, defaultToolUI } from "./factory.js";
import { lspToolUI } from "./lsp/ui.js";
import {
  hasServerFor,
  getDiagnostics,
  lspRequest,
  type Diagnostic,
} from "./lsp/client.js";

type Operation = "diagnostics" | "hover" | "definition" | "references";

interface LspParams {
  operation: Operation;
  filePath: string;
  line?: number; // 1-based
  character?: number; // 1-based
}

const OPERATIONS: Operation[] = ["diagnostics", "hover", "definition", "references"];

const lspSchema: JsonSchema = {
  type: "object",
  properties: {
    operation: {
      description:
        "LSP operation: 'diagnostics' (errors/warnings for a file), 'hover', 'definition', or 'references'. Positional ops need line & character.",
      enum: OPERATIONS,
    },
    filePath: { description: "Absolute or cwd-relative path to the file" },
    line: {
      description: "1-based line number (required for hover/definition/references)",
      type: "number",
    },
    character: {
      description:
        "1-based character offset (required for hover/definition/references)",
      type: "number",
    },
  },
  required: ["operation", "filePath"],
};

function validateLspInput(
  params: unknown,
): { valid: true } | { valid: false; error: string } {
  if (!params || typeof params !== "object") {
    return { valid: false, error: "Expected object parameters" };
  }
  const p = params as Record<string, unknown>;
  if (typeof p.operation !== "string" || !OPERATIONS.includes(p.operation as Operation)) {
    return { valid: false, error: `operation must be one of ${OPERATIONS.join(", ")}` };
  }
  if (typeof p.filePath !== "string" || p.filePath.length === 0) {
    return { valid: false, error: "filePath is required and must be a string" };
  }
  if (p.operation !== "diagnostics") {
    if (typeof p.line !== "number" || typeof p.character !== "number") {
      return {
        valid: false,
        error: `operation '${p.operation}' requires line and character`,
      };
    }
  }
  return { valid: true };
}

const SEVERITY: Record<number, string> = {
  1: "ERROR",
  2: "WARN",
  3: "INFO",
  4: "HINT",
};

function formatDiagnostics(file: string, diags: Diagnostic[]): string {
  if (diags.length === 0) return `No diagnostics for ${file}`;
  return diags
    .map((d) => {
      const line = d.range.start.line + 1;
      const col = d.range.start.character + 1;
      const sev = SEVERITY[d.severity ?? 1] ?? "ERROR";
      const src = d.source ? ` [${d.source}]` : "";
      return `${sev} ${line}:${col}${src} ${d.message}`;
    })
    .join("\n");
}

// Render an LSP Location / Location[] result compactly.
function formatLocations(result: unknown): string {
  const list = Array.isArray(result) ? result : result ? [result] : [];
  if (list.length === 0) return "No results found";
  return list
    .map((loc) => {
      const l = loc as { uri?: string; range?: { start?: { line: number; character: number } } };
      const uri = l.uri ?? "";
      let file = uri;
      try {
        file = uri.startsWith("file:") ? fileURLToPath(uri) : uri;
      } catch {
        /* keep uri */
      }
      const start = l.range?.start;
      return start ? `${file}:${start.line + 1}:${start.character + 1}` : file;
    })
    .join("\n");
}

function formatHover(result: unknown): string {
  if (!result || typeof result !== "object") return "No hover information";
  const contents = (result as { contents?: unknown }).contents;
  if (typeof contents === "string") return contents;
  if (Array.isArray(contents)) {
    return contents
      .map((c) => (typeof c === "string" ? c : (c as { value?: string }).value ?? ""))
      .join("\n");
  }
  if (contents && typeof contents === "object") {
    return (contents as { value?: string }).value ?? "No hover information";
  }
  return "No hover information";
}

async function executeLsp(
  params: LspParams,
  ctx: ToolContext,
): Promise<
  ToolExecutionResult<{
    title: string;
    output: string;
    metadata?: Record<string, unknown>;
  }>
> {
  const root = ctx.projectPath ?? ctx.cwd;
  const file = path.isAbsolute(params.filePath)
    ? params.filePath
    : path.resolve(root, params.filePath);

  if (!fs.existsSync(file)) {
    return { success: false, error: `File not found: ${file}` };
  }
  if (!hasServerFor(file)) {
    return {
      success: false,
      error: `No LSP server configured for '${path.extname(file)}' files. Set FREECODE_LSP_SERVERS to add one.`,
    };
  }

  try {
    if (params.operation === "diagnostics") {
      const diags = await getDiagnostics(file, root);
      return {
        success: true,
        result: {
          title: `diagnostics ${path.relative(root, file)}`,
          output: formatDiagnostics(path.relative(root, file), diags),
          metadata: { count: diags.length },
        },
      };
    }

    const line = (params.line ?? 1) - 1;
    const character = (params.character ?? 1) - 1;
    const result = await lspRequest(params.operation, file, root, line, character);
    const output =
      params.operation === "hover" ? formatHover(result) : formatLocations(result);

    return {
      success: true,
      result: {
        title: `${params.operation} ${path.relative(root, file)}:${params.line}:${params.character}`,
        output,
        metadata: {},
      },
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export const LspTool: Tool<LspParams> = buildTool({
  id: "lsp",
  description:
    "Query a language server about code: 'diagnostics' for a file's errors/warnings, or 'hover'/'definition'/'references' at a position. Requires the relevant language server installed on the host.",
  schemas: { parameters: lspSchema },
  permissions: { operations: ["file.read", "subprocess"] },
  behavior: {
    isConcurrencySafe: true,
    isDestructive: false,
    userFacingName: "LSP",
  },
  ui: { ...defaultToolUI, ...lspToolUI },
  execute: executeLsp,
  validateInput: validateLspInput,
  getPath: (params) => params.filePath,
  isSearchOrReadCommand: () => ({ isSearch: false, isRead: true }),
});
