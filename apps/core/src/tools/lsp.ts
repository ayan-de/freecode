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
import { buildTool } from "./factory.js";
import {
  hasServerFor,
  getDiagnostics,
  lspRequest,
  type Diagnostic,
} from "./lsp/client.js";
import {
  getFileSymbols,
  queryWorkspaceSymbols,
  type CodeSymbol,
} from "../repo-map/index.js";

type Operation =
  | "diagnostics"
  | "hover"
  | "definition"
  | "references"
  | "documentSymbol"
  | "workspaceSymbol";

interface LspParams {
  operation: Operation;
  filePath?: string;
  line?: number; // 1-based
  character?: number; // 1-based
  query?: string; // for workspaceSymbol
}

const OPERATIONS: Operation[] = [
  "diagnostics",
  "hover",
  "definition",
  "references",
  "documentSymbol",
  "workspaceSymbol",
];

// Symbol ops are backed by tree-sitter (no language server needed), so they
// work for TS/TSX/JS/JSX/Python everywhere without host LSP setup.
const POSITION_OPS: Operation[] = ["hover", "definition", "references"];

const lspSchema: JsonSchema = {
  type: "object",
  properties: {
    operation: {
      description:
        "Operation: 'documentSymbol' (list symbols defined in a file, needs filePath), 'workspaceSymbol' (find symbols by name across the repo, needs query), 'diagnostics' (a file's errors/warnings), or 'hover'/'definition'/'references' at a position (need line & character). documentSymbol/workspaceSymbol use tree-sitter and need no language server; the others require the host language server.",
      enum: OPERATIONS,
    },
    filePath: {
      description:
        "Absolute or cwd-relative path to the file (required for all ops except workspaceSymbol)",
      type: "string",
    },
    line: {
      description: "1-based line number (required for hover/definition/references)",
      type: "number",
    },
    character: {
      description:
        "1-based character offset (required for hover/definition/references)",
      type: "number",
    },
    query: {
      description: "Symbol name (or substring) to search for (required for workspaceSymbol)",
      type: "string",
    },
  },
  required: ["operation"],
};

function validateLspInput(
  params: unknown,
): { valid: true } | { valid: false; error: string } {
  if (!params || typeof params !== "object") {
    return { valid: false, error: "Expected object parameters" };
  }
  const p = params as Record<string, unknown>;
  const op = p.operation;
  if (typeof op !== "string" || !OPERATIONS.includes(op as Operation)) {
    return { valid: false, error: `operation must be one of ${OPERATIONS.join(", ")}` };
  }

  if (op === "workspaceSymbol") {
    if (typeof p.query !== "string" || p.query.trim().length === 0) {
      return { valid: false, error: "workspaceSymbol requires a non-empty 'query'" };
    }
    return { valid: true };
  }

  // Every other op is scoped to a file.
  if (typeof p.filePath !== "string" || p.filePath.length === 0) {
    return { valid: false, error: "filePath is required and must be a string" };
  }

  if (POSITION_OPS.includes(op as Operation)) {
    // Accept numeric strings too — some providers quote numbers.
    const isNum = (v: unknown) =>
      typeof v === "number" ||
      (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)));
    if (!isNum(p.line) || !isNum(p.character)) {
      return {
        valid: false,
        error: `operation '${op}' requires line and character`,
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

// Render tree-sitter symbols as `line: name [kind]`, grouped for readability.
function formatSymbols(symbols: CodeSymbol[], withPath: boolean): string {
  if (symbols.length === 0) return "No symbols found";
  return symbols
    .map((s) =>
      withPath
        ? `${s.filePath}:${s.line}: ${s.name} [${s.kind}]`
        : `${s.line}: ${s.name} [${s.kind}]`,
    )
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

  // Tree-sitter-backed symbol ops — no language server required.
  if (params.operation === "workspaceSymbol") {
    const query = params.query ?? "";
    const symbols = await queryWorkspaceSymbols(root, query);
    return {
      success: true,
      result: {
        title: `workspaceSymbol "${query}"`,
        output: formatSymbols(symbols, true),
        metadata: { count: symbols.length },
      },
    };
  }

  const file = path.isAbsolute(params.filePath!)
    ? params.filePath!
    : path.resolve(root, params.filePath!);

  if (!fs.existsSync(file)) {
    return { success: false, error: `File not found: ${file}` };
  }

  if (params.operation === "documentSymbol") {
    const symbols = await getFileSymbols(root, file);
    return {
      success: true,
      result: {
        title: `documentSymbol ${path.relative(root, file)}`,
        output: formatSymbols(symbols, false),
        metadata: { count: symbols.length },
      },
    };
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

    const line = (Number(params.line) || 1) - 1;
    const character = (Number(params.character) || 1) - 1;
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
    "Code intelligence. Prefer over read/grep for locating code: 'workspaceSymbol' finds a symbol by name across the repo, 'documentSymbol' lists a file's symbols — both tree-sitter-backed (TS/JS/Python), no language server needed. 'diagnostics'/'hover'/'definition'/'references' use the host language server.",
  schemas: { parameters: lspSchema },
  permissions: { operations: ["file.read", "subprocess"] },
  behavior: {
    isConcurrencySafe: true,
    isDestructive: false,
    userFacingName: "LSP",
  },
  execute: executeLsp,
  validateInput: validateLspInput,
  getPath: (params) => params.filePath ?? "",
  isSearchOrReadCommand: () => ({ isSearch: false, isRead: true }),
});
