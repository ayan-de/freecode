// =============================================================================
// Symbol index — tree-sitter-backed symbol lookup for the lsp tool's
// documentSymbol / workspaceSymbol operations (grok-style "pull" model).
//
// Nothing here is injected into the prompt: the model queries symbols on demand
// so there is zero standing token cost. Whole-repo symbol lists are cached per
// project by git HEAD + a short TTL; single-file lookups parse fresh (cheap).
// Degrades to [] when tree-sitter grammars can't load.
// =============================================================================

import * as fs from "fs";
import * as path from "path";
import fg from "fast-glob";
import { initParsers, parseFile, isSupported, type CodeSymbol } from "./parser.js";
import { logger } from "../utils/logger.js";

export type { CodeSymbol };

export interface SymbolScanOptions {
  include?: string[];
  exclude?: string[];
  maxFiles?: number;
}

interface SymbolCache {
  symbols: CodeSymbol[];
  gitHead: string;
  timestamp: number;
}

const DEFAULT_INCLUDE = ["**/*.ts", "**/*.tsx", "**/*.js", "**/*.jsx", "**/*.py"];

const DEFAULT_EXCLUDE = [
  "**/node_modules/**",
  "**/dist/**",
  "**/build/**",
  "**/.git/**",
  "**/coverage/**",
  "**/*.d.ts",
  "**/*.min.js",
];

const DEFAULT_MAX_FILES = 2000;
const TTL_MS = 5 * 60 * 1000;

// Per-project cache (a single daemon can serve multiple project paths).
const caches = new Map<string, SymbolCache>();

async function getGitHead(projectPath: string): Promise<string> {
  try {
    const content = await fs.promises.readFile(
      path.join(projectPath, ".git", "HEAD"),
      "utf-8",
    );
    const ref = content.match(/ref: (.+)/);
    if (ref) {
      try {
        return (
          await fs.promises.readFile(
            path.join(projectPath, ".git", ref[1].trim()),
            "utf-8",
          )
        ).trim();
      } catch {
        return ref[1].trim(); // unborn branch — ref exists, no commit yet
      }
    }
    return content.trim(); // detached HEAD
  } catch {
    return "no-git";
  }
}

async function scanFiles(
  projectPath: string,
  options: SymbolScanOptions,
): Promise<string[]> {
  const files = await fg(options.include ?? DEFAULT_INCLUDE, {
    cwd: projectPath,
    ignore: options.exclude ?? DEFAULT_EXCLUDE,
    absolute: false,
    onlyFiles: true,
    dot: false,
  });
  return files.slice(0, options.maxFiles ?? DEFAULT_MAX_FILES);
}

async function buildSymbols(
  projectPath: string,
  options: SymbolScanOptions,
): Promise<CodeSymbol[]> {
  if (!(await initParsers())) return [];

  const relPaths = await scanFiles(projectPath, options);
  const symbols: CodeSymbol[] = [];

  await Promise.all(
    relPaths.map(async (rel) => {
      if (!isSupported(rel)) return;
      try {
        const content = await fs.promises.readFile(
          path.join(projectPath, rel),
          "utf-8",
        );
        symbols.push(...parseFile(rel, content, rel));
      } catch (error) {
        logger.debug(`symbols: skip ${rel}: ${error}`);
      }
    }),
  );

  return symbols;
}

/** All symbols in the project, cached by git HEAD + TTL. */
export async function getProjectSymbols(
  projectPath: string,
  options: SymbolScanOptions = {},
): Promise<CodeSymbol[]> {
  const gitHead = await getGitHead(projectPath);
  const cached = caches.get(projectPath);
  if (
    cached &&
    cached.gitHead === gitHead &&
    Date.now() - cached.timestamp < TTL_MS
  ) {
    return cached.symbols;
  }

  try {
    const symbols = await buildSymbols(projectPath, options);
    caches.set(projectPath, { symbols, gitHead, timestamp: Date.now() });
    return symbols;
  } catch (error) {
    logger.debug(`symbols: build failed: ${error}`);
    return [];
  }
}

/**
 * Symbols defined in a single file. Parses fresh (cheap) so results are always
 * current, independent of the whole-project cache.
 */
export async function getFileSymbols(
  projectPath: string,
  filePath: string,
): Promise<CodeSymbol[]> {
  if (!(await initParsers())) return [];
  const abs = path.isAbsolute(filePath)
    ? filePath
    : path.resolve(projectPath, filePath);
  const rel = path.relative(projectPath, abs) || path.basename(abs);
  try {
    const content = await fs.promises.readFile(abs, "utf-8");
    return parseFile(abs, content, rel);
  } catch (error) {
    logger.debug(`symbols: failed to read ${filePath}: ${error}`);
    return [];
  }
}

/**
 * Find symbols by name across the project, ranked exact → prefix → substring.
 * Case-insensitive. Returns at most `limit` matches.
 */
export async function queryWorkspaceSymbols(
  projectPath: string,
  query: string,
  limit = 50,
): Promise<CodeSymbol[]> {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const symbols = await getProjectSymbols(projectPath);

  const scored: Array<{ sym: CodeSymbol; score: number }> = [];
  for (const sym of symbols) {
    const name = sym.name.toLowerCase();
    let score: number;
    if (name === q) score = 0;
    else if (name.startsWith(q)) score = 1;
    else if (name.includes(q)) score = 2;
    else continue;
    scored.push({ sym, score });
  }

  scored.sort(
    (a, b) =>
      a.score - b.score ||
      a.sym.name.length - b.sym.name.length ||
      a.sym.filePath.localeCompare(b.sym.filePath) ||
      a.sym.line - b.sym.line,
  );

  return scored.slice(0, limit).map((s) => s.sym);
}

/** Drop the cached symbols for a project (or all projects when omitted). */
export function invalidateSymbolCache(projectPath?: string): void {
  if (projectPath) caches.delete(projectPath);
  else caches.clear();
}
