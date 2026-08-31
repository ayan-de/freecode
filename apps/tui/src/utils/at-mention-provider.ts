// =============================================================================
// `@` file-mention autocomplete without fd
// pi-tui's CombinedAutocompleteProvider answers `@` only when it was handed an
// fd binary, and returns nothing at all otherwise. This wraps it: `@` prefixes
// are served from the JS walker in file-search.ts, everything else (slash
// commands, bare path completion) is delegated untouched.
//
// The prefix parsing and completion-value shapes below deliberately mirror
// pi-tui's, because applyCompletion() — which stays delegated — reads them back
// (a trailing "/" on the label means "directory: don't append a space").
// =============================================================================

import { statSync } from "fs";
import { homedir } from "os";
import * as path from "path";
import { CombinedAutocompleteProvider } from "@earendil-works/pi-tui";
import type {
  AutocompleteItem,
  AutocompleteProvider,
  AutocompleteSuggestions,
  SlashCommand,
} from "@earendil-works/pi-tui";
import { resolveFdPath } from "./fd-path.js";
import { searchFiles } from "./file-search.js";

const PATH_DELIMITERS = new Set([" ", "\t", '"', "'", "="]);

function isTokenStart(text: string, index: number): boolean {
  return index === 0 || PATH_DELIMITERS.has(text[index - 1] ?? "");
}

/** Start of an unterminated `"…` run, so quoted paths keep their spaces. */
function findUnclosedQuoteStart(text: string): number | null {
  let inQuotes = false;
  let quoteStart = -1;
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === '"') {
      inQuotes = !inQuotes;
      if (inQuotes) quoteStart = i;
    }
  }
  return inQuotes ? quoteStart : null;
}

/** The `@…` token under the cursor, or null when the cursor isn't in one. */
export function extractAtPrefix(text: string): string | null {
  const quoteStart = findUnclosedQuoteStart(text);
  if (quoteStart !== null && quoteStart > 0 && text[quoteStart - 1] === "@") {
    return isTokenStart(text, quoteStart - 1)
      ? text.slice(quoteStart - 1)
      : null;
  }

  let tokenStart = 0;
  for (let i = text.length - 1; i >= 0; i -= 1) {
    if (PATH_DELIMITERS.has(text[i] ?? "")) {
      tokenStart = i + 1;
      break;
    }
  }
  return text[tokenStart] === "@" ? text.slice(tokenStart) : null;
}

function expandHome(value: string): string {
  if (value === "~") return homedir();
  if (value.startsWith("~/")) {
    const expanded = path.join(homedir(), value.slice(2));
    return value.endsWith("/") && !expanded.endsWith("/")
      ? `${expanded}/`
      : expanded;
  }
  return value;
}

interface ScopedQuery {
  /** Directory the walk starts from. */
  baseDir: string;
  /** What to match entry names against, below baseDir. */
  query: string;
  /** baseDir as the user typed it, re-attached to results. */
  displayBase: string;
}

/**
 * Split `apps/doc` into "look under apps/ for doc". Returns null when the query
 * names no directory — then the whole root is searched and the query is matched
 * against full paths, which is what fd --full-path does.
 */
function resolveScopedQuery(
  rawQuery: string,
  root: string,
): ScopedQuery | null {
  const normalized = rawQuery.replace(/\\/g, "/");
  const slashIndex = normalized.lastIndexOf("/");
  if (slashIndex === -1) return null;

  const displayBase = normalized.slice(0, slashIndex + 1);
  const query = normalized.slice(slashIndex + 1);
  const expanded = expandHome(displayBase);
  const baseDir = path.isAbsolute(expanded)
    ? expanded
    : path.join(root, expanded);

  try {
    if (!statSync(baseDir).isDirectory()) return null;
  } catch {
    return null;
  }
  return { baseDir, query, displayBase };
}

function buildValue(displayPath: string, isQuotedPrefix: boolean): string {
  const needsQuotes = isQuotedPrefix || displayPath.includes(" ");
  return needsQuotes ? `@"${displayPath}"` : `@${displayPath}`;
}

export class AtMentionAutocompleteProvider implements AutocompleteProvider {
  constructor(
    private readonly inner: CombinedAutocompleteProvider,
    private readonly basePath: string,
  ) {}

  async getSuggestions(
    lines: string[],
    cursorLine: number,
    cursorCol: number,
    options: { signal: AbortSignal; force?: boolean },
  ): Promise<AutocompleteSuggestions | null> {
    const textBeforeCursor = (lines[cursorLine] ?? "").slice(0, cursorCol);
    const atPrefix = extractAtPrefix(textBeforeCursor);
    if (atPrefix === null) {
      return this.inner.getSuggestions(lines, cursorLine, cursorCol, options);
    }

    const isQuotedPrefix = atPrefix.startsWith('@"');
    const rawPrefix = atPrefix.slice(isQuotedPrefix ? 2 : 1);
    const items = await this.suggestFiles(
      rawPrefix,
      isQuotedPrefix,
      options.signal,
    );
    return items.length > 0 ? { items, prefix: atPrefix } : null;
  }

  applyCompletion(
    lines: string[],
    cursorLine: number,
    cursorCol: number,
    item: AutocompleteItem,
    prefix: string,
  ) {
    return this.inner.applyCompletion(
      lines,
      cursorLine,
      cursorCol,
      item,
      prefix,
    );
  }

  shouldTriggerFileCompletion(
    lines: string[],
    cursorLine: number,
    cursorCol: number,
  ): boolean {
    return this.inner.shouldTriggerFileCompletion(lines, cursorLine, cursorCol);
  }

  private async suggestFiles(
    rawPrefix: string,
    isQuotedPrefix: boolean,
    signal: AbortSignal,
  ): Promise<AutocompleteItem[]> {
    if (signal.aborted) return [];
    try {
      const scoped = resolveScopedQuery(rawPrefix, this.basePath);
      const root = scoped?.baseDir ?? this.basePath;
      const query = scoped?.query ?? rawPrefix.replace(/\\/g, "/");
      const entries = await searchFiles(root, query, signal);
      if (signal.aborted) return [];

      return entries.map(({ path: relPath, isDirectory }) => {
        const displayPath = scoped
          ? `${scoped.displayBase}${relPath}`
          : relPath;
        const suffix = isDirectory ? "/" : "";
        return {
          value: buildValue(`${displayPath}${suffix}`, isQuotedPrefix),
          label: `${path.posix.basename(displayPath)}${suffix}`,
          description: displayPath,
        };
      });
    } catch {
      return [];
    }
  }
}

/**
 * The editor's autocomplete provider. fd stays the primary `@` backend where it
 * exists — it is faster and honours .gitignore — and the JS walker only stands
 * in when fd is missing, which on Windows is the normal case.
 */
export function createAutocompleteProvider(
  commands: (AutocompleteItem | SlashCommand)[],
  basePath: string,
): AutocompleteProvider {
  const fdPath = resolveFdPath();
  const combined = new CombinedAutocompleteProvider(commands, basePath, fdPath);
  return fdPath
    ? combined
    : new AtMentionAutocompleteProvider(combined, basePath);
}
