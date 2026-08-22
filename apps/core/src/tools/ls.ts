// =============================================================================
// Ls Tool - List directory contents with UI rendering
// =============================================================================

import * as fs from "fs";
import * as path from "path";
import type { ToolContext } from "./types.js";
import type { Tool, ToolExecutionResult, JsonSchema } from "./tool.types.js";
import { buildTool } from "./factory.js";

interface LsParams {
  path?: string;
  ignore?: string[];
}

const MAX_ENTRIES = 100;
const DEFAULT_IGNORE = [
  "node_modules",
  "__pycache__",
  ".git",
  "dist",
  "build",
  "target",
  ".next",
  ".nuxt",
  "venv",
  ".venv",
  "coverage",
  ".cache",
];

// =============================================================================
// Ls Schema
// =============================================================================

const lsSchema: JsonSchema = {
  type: "object",
  properties: {
    path: {
      type: "string",
      description: "Directory path to list (defaults to current directory)",
    },
    ignore: {
      type: "array",
      items: { type: "string" },
      description: "Additional patterns to ignore",
    },
  },
};

// =============================================================================
// Input validation
// =============================================================================

function validateLsInput(
  params: unknown,
): { valid: true } | { valid: false; error: string } {
  if (!params || typeof params !== "object") {
    return { valid: false, error: "Expected object parameters" };
  }
  const p = params as Record<string, unknown>;
  if (p.path !== undefined && typeof p.path !== "string") {
    return { valid: false, error: "path must be a string" };
  }
  if (p.ignore !== undefined && !Array.isArray(p.ignore)) {
    return { valid: false, error: "ignore must be an array" };
  }
  return { valid: true };
}

// =============================================================================
// Helper types and functions
// =============================================================================

interface DirEntry {
  name: string;
  isDir: boolean;
  depth: number;
}

function collectEntries(
  dir: string,
  depth: number,
  ignorePatterns: string[],
  entries: DirEntry[],
  max: number,
): void {
  if (entries.length >= max) {
    return;
  }

  let items: fs.Dirent[];
  try {
    items = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }

  // Sort: directories first, then files, alphabetically
  items.sort((a, b) => {
    if (a.isDirectory() && !b.isDirectory()) return -1;
    if (!a.isDirectory() && b.isDirectory()) return 1;
    return a.name.localeCompare(b.name);
  });

  for (const item of items) {
    if (entries.length >= max) {
      break;
    }

    const name = item.name;

    // Skip hidden files (except . and ..)
    if (name.startsWith(".") && name !== "." && name !== "..") {
      continue;
    }

    // Check ignore patterns
    const isIgnored = ignorePatterns.some((pattern) => {
      // Simple exact match or glob-like matching
      if (name === pattern) return true;
      // Simple glob patterns
      if (pattern.includes("*")) {
        const regex = new RegExp(
          "^" + pattern.replace(/\*/g, ".*").replace(/\?/g, ".") + "$",
        );
        return regex.test(name);
      }
      return false;
    });

    if (isIgnored) {
      continue;
    }

    const isDir = item.isDirectory();
    entries.push({
      name,
      isDir,
      depth: depth + 1,
    });

    // Recurse into directories up to depth 5
    if (isDir && depth < 5) {
      const subdir = path.join(dir, name);
      collectEntries(subdir, depth + 1, ignorePatterns, entries, max);
    }
  }
}

// =============================================================================
// Execute function
// =============================================================================

async function executeLs(
  params: LsParams,
  ctx: ToolContext,
): Promise<
  ToolExecutionResult<{
    title: string;
    output: string;
    metadata?: Record<string, unknown>;
  }>
> {
  try {
    const basePath = params.path || ".";
    let resolvedPath = basePath;

    if (!path.isAbsolute(resolvedPath)) {
      resolvedPath = path.resolve(ctx.cwd, resolvedPath);
    }

    if (!fs.existsSync(resolvedPath)) {
      return {
        success: false,
        error: `Directory not found: ${basePath}`,
      };
    }

    const stat = fs.statSync(resolvedPath);
    if (!stat.isDirectory()) {
      return {
        success: false,
        error: `Not a directory: ${basePath}`,
      };
    }

    // Build ignore patterns
    const ignorePatterns = [...DEFAULT_IGNORE];
    if (params.ignore) {
      ignorePatterns.push(...params.ignore);
    }

    const entries: DirEntry[] = [];
    collectEntries(resolvedPath, 0, ignorePatterns, entries, MAX_ENTRIES);

    const truncated = entries.length >= MAX_ENTRIES;

    // Build output
    let output = `${basePath}/\n`;

    for (const entry of entries) {
      const indent = "  ".repeat(entry.depth);
      const suffix = entry.isDir ? "/" : "";
      output += `${indent}${entry.name}${suffix}\n`;
    }

    if (truncated) {
      output += `\n... truncated at ${MAX_ENTRIES} entries`;
    }

    const fileCount = entries.filter((e) => !e.isDir).length;
    const dirCount = entries.filter((e) => e.isDir).length;
    output += `\n${fileCount} files, ${dirCount} directories`;

    return {
      success: true,
      result: {
        title: path.basename(resolvedPath) || resolvedPath,
        output,
        metadata: { truncated, fileCount, dirCount },
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
// LsTool - Built with buildTool() factory
// =============================================================================

export const LsTool: Tool<LsParams> = buildTool({
  id: "ls",
  description: `List a directory as an indented tree, recursing up to 5 levels and capped at 100 entries. \`ignore\` adds patterns on top of the defaults.

Use it to orient yourself in a directory you have not seen. Once you know what you are after, \`glob\` (by name) or \`grep\` (by content) answers directly and returns far less — don't walk a repo with \`ls\` looking for a file.`,
  schemas: {
    parameters: lsSchema,
  },
  permissions: {
    operations: ["file.read"],
  },
  behavior: {
    isConcurrencySafe: true,
    isDestructive: false,
    userFacingName: "List Directory",
  },
  execute: executeLs,
  validateInput: validateLsInput,
  isSearchOrReadCommand: () => ({ isSearch: false, isRead: true }),
  getPath: (params) => params.path || ".",
});
