// =============================================================================
// Repo Map Parser — extract top-level symbols via web-tree-sitter (WASM).
//
// Uses tree-sitter *tag queries* (.scm) rather than hand-walking node types:
// far more robust for arrow-fn consts, exported members, React.forwardRef, etc.
// Queries adapted from the grok-build codebase-graph / aider repomap approach.
//
// WASM grammars ship prebuilt inside the tree-sitter-<lang> packages, and the
// runtime ships in web-tree-sitter — so this needs no native build toolchain.
// If any grammar fails to load, the whole module degrades to "no symbols" so
// the agent's context path never breaks (keyword/tree fallback still applies).
// =============================================================================

import * as fs from "fs";
import { createRequire } from "module";
import { Parser, Language, Query } from "web-tree-sitter";
import { logger } from "../utils/logger.js";

const require = createRequire(import.meta.url);

export interface CodeSymbol {
  name: string;
  kind: string;
  /** Project-relative path. */
  filePath: string;
  line: number;
}

type LangKey = "typescript" | "tsx" | "javascript" | "python";

// Map file extension → grammar. Kept small on purpose (matches freecode's stack).
const EXT_TO_LANG: Record<string, LangKey> = {
  ".ts": "typescript",
  ".mts": "typescript",
  ".cts": "typescript",
  ".tsx": "tsx",
  ".js": "javascript",
  ".jsx": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".py": "python",
};

// [package, wasm filename] — resolved from node_modules at init time.
const GRAMMAR_WASM: Record<LangKey, [string, string]> = {
  typescript: ["tree-sitter-typescript", "tree-sitter-typescript.wasm"],
  tsx: ["tree-sitter-typescript", "tree-sitter-tsx.wasm"],
  javascript: ["tree-sitter-javascript", "tree-sitter-javascript.wasm"],
  python: ["tree-sitter-python", "tree-sitter-python.wasm"],
};

// Tag queries: capture names follow `name.definition.<kind>`; the <kind> suffix
// becomes the symbol kind. Only top-level-relevant definitions are captured.
// Arrow-fn consts are anchored to module top level / export statements so
// local `const x = () => …` inside a function body isn't mistaken for a symbol.
const TS_QUERY = `
(function_declaration name: (identifier) @name.definition.function)
(class_declaration name: (type_identifier) @name.definition.class)
(interface_declaration name: (type_identifier) @name.definition.interface)
(type_alias_declaration name: (type_identifier) @name.definition.type)
(enum_declaration name: (identifier) @name.definition.enum)
(method_definition name: (property_identifier) @name.definition.method)
(program (lexical_declaration (variable_declarator
  name: (identifier) @name.definition.function value: (arrow_function))))
(export_statement (lexical_declaration (variable_declarator
  name: (identifier) @name.definition.function value: (arrow_function))))
`;

const JS_QUERY = `
(function_declaration name: (identifier) @name.definition.function)
(class_declaration name: (identifier) @name.definition.class)
(method_definition name: (property_identifier) @name.definition.method)
(program (lexical_declaration (variable_declarator
  name: (identifier) @name.definition.function value: (arrow_function))))
(export_statement (lexical_declaration (variable_declarator
  name: (identifier) @name.definition.function value: (arrow_function))))
`;

const PY_QUERY = `
(function_definition name: (identifier) @name.definition.function)
(class_definition name: (identifier) @name.definition.class)
`;

const QUERY_SOURCE: Record<LangKey, string> = {
  typescript: TS_QUERY,
  tsx: TS_QUERY,
  javascript: JS_QUERY,
  python: PY_QUERY,
};

const CAPTURE_PREFIX = "name.definition.";

// Lazily-initialised, shared across the process. parse() is synchronous, so
// reusing one parser per language is safe even under parallel scanning.
let initPromise: Promise<boolean> | null = null;
const parsers = new Map<LangKey, Parser>();
const queries = new Map<LangKey, Query>();

/**
 * Initialise the WASM runtime and all grammars once. Returns false (and logs at
 * debug level) if tree-sitter is unavailable, so callers can degrade quietly.
 */
export function initParsers(): Promise<boolean> {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    try {
      await Parser.init({
        locateFile: () => require.resolve("web-tree-sitter/web-tree-sitter.wasm"),
      });
      for (const key of Object.keys(GRAMMAR_WASM) as LangKey[]) {
        const [pkg, file] = GRAMMAR_WASM[key];
        const bytes = fs.readFileSync(require.resolve(`${pkg}/${file}`));
        const lang = await Language.load(bytes);
        const parser = new Parser();
        parser.setLanguage(lang);
        parsers.set(key, parser);
        queries.set(key, new Query(lang, QUERY_SOURCE[key]));
      }
      return true;
    } catch (error) {
      logger.debug(`repo-map: tree-sitter unavailable, skipping map: ${error}`);
      return false;
    }
  })();
  return initPromise;
}

function langForFile(filePath: string): LangKey | null {
  const dot = filePath.lastIndexOf(".");
  if (dot < 0) return null;
  return EXT_TO_LANG[filePath.slice(dot).toLowerCase()] ?? null;
}

/**
 * Parse one file's contents and extract its top-level symbols. `relPath` is the
 * project-relative path stored on each symbol. Must be called after
 * initParsers() has resolved; unknown/unsupported files return [].
 */
export function parseFile(
  filePath: string,
  content: string,
  relPath: string,
): CodeSymbol[] {
  const key = langForFile(filePath);
  if (!key) return [];
  const parser = parsers.get(key);
  const query = queries.get(key);
  if (!parser || !query) return [];

  let tree = null;
  try {
    tree = parser.parse(content);
    if (!tree) return [];
    const symbols: CodeSymbol[] = [];
    for (const cap of query.captures(tree.rootNode)) {
      if (!cap.name.startsWith(CAPTURE_PREFIX)) continue;
      const name = cap.node.text;
      if (!name) continue;
      symbols.push({
        name,
        kind: cap.name.slice(CAPTURE_PREFIX.length),
        filePath: relPath,
        line: cap.node.startPosition.row + 1,
      });
    }
    return symbols;
  } catch (error) {
    logger.debug(`repo-map: failed to parse ${relPath}: ${error}`);
    return [];
  } finally {
    tree?.delete();
  }
}

export function isSupported(filePath: string): boolean {
  return langForFile(filePath) !== null;
}
