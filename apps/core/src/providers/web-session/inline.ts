// =============================================================================
// Gemini web session — @mention expansion
//
// Turns "@src/a.ts @src/b.ts why does this fail?" into the same question with
// both files' contents appended verbatim.
//
// This exists because the session cannot be trusted to fetch files itself.
// Measured over 9 real turns, it emitted a tool call ~56% of the time; the
// other turns it answered from priors and invented the contents (one run
// reported "23 quarantined cases" for a file that says 3, complete with a
// fabricated verbatim quote). Inlining removes the choice: with the bytes
// already in the prompt and no tools offered, the same question scored 4/4.
//
// So the budget below is not a performance tuning knob. Content that does not
// fit is content the model will be tempted to invent, which is why an
// over-budget file is reported as truncated rather than silently shortened.
// =============================================================================

import * as fs from "fs";
import * as path from "path";

/** Leaves room for the preamble and the reply under the endpoint's payload
 *  ceiling (~60 KB observed). Deliberately not the whole ceiling: history is
 *  re-sent on every turn, because the transport keeps no server-side thread. */
export const DEFAULT_BUDGET_BYTES = 45_000;

export interface InlinedFile {
  /** Project-relative, as it will be shown to the model. */
  path: string;
  bytes: number;
  truncated: boolean;
}

export interface SkippedMention {
  mention: string;
  reason: string;
}

export interface Expansion {
  text: string;
  files: InlinedFile[];
  skipped: SkippedMention[];
}

// A mention starts at a word boundary so an email address or a decorator
// (@Component) is not read as a path. Trailing sentence punctuation is trimmed
// after the match — "@read.ts," is a path plus a comma, but "@read.ts" is not
// "@read" plus ".ts".
const MENTION = /(?:^|\s)@([^\s]+)/g;
const TRAILING_PUNCTUATION = /[.,;:!?)\]}]+$/;

const FENCE_LANGUAGE: Record<string, string> = {
  ".ts": "ts",
  ".tsx": "tsx",
  ".js": "js",
  ".jsx": "jsx",
  ".mjs": "js",
  ".json": "json",
  ".md": "markdown",
  ".py": "python",
  ".rs": "rust",
  ".go": "go",
  ".sh": "bash",
  ".yml": "yaml",
  ".yaml": "yaml",
  ".toml": "toml",
  ".css": "css",
  ".html": "html",
};

/** Mentions in first-seen order, punctuation trimmed, de-duplicated. */
export function findMentions(text: string): string[] {
  const seen = new Set<string>();
  for (const match of text.matchAll(MENTION)) {
    const mention = match[1].replace(TRAILING_PUNCTUATION, "");
    if (mention) seen.add(mention);
  }
  return [...seen];
}

/** A NUL in the first 4 KB. Cheap, and the only case that matters: a binary
 *  inlined as text is pure payload burn with nothing readable at the far end. */
function looksBinary(buffer: Buffer): boolean {
  return buffer.subarray(0, 4096).includes(0);
}

/** Resolves a mention under `root`, or explains why it cannot be inlined.
 *  Traversal is rejected rather than clamped: "@../../.ssh/id_rsa" is a
 *  request to leave the project, and quietly reading something else would be
 *  worse than refusing. */
function resolve(
  mention: string,
  root: string,
): { absolute: string; relative: string } | { reason: string } {
  const absolute = path.resolve(root, mention);
  const relative = path.relative(root, absolute);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return { reason: "outside the project directory" };
  }
  let stat: fs.Stats;
  try {
    stat = fs.statSync(absolute);
  } catch {
    return { reason: "not found" };
  }
  if (stat.isDirectory()) return { reason: "is a directory" };
  if (!stat.isFile()) return { reason: "not a regular file" };
  return { absolute, relative: relative || mention };
}

/**
 * Read an ordered list of mentions into fenced blocks, newest-first callers
 * getting budget priority. Split out from `expandMentions` because a
 * conversation's mentions come from every user turn, not just the last one.
 */
export function inlineFiles(
  mentions: string[],
  root: string = process.cwd(),
  budgetBytes: number = DEFAULT_BUDGET_BYTES,
): { block: string; files: InlinedFile[]; skipped: SkippedMention[] } {
  const files: InlinedFile[] = [];
  const skipped: SkippedMention[] = [];
  const blocks: string[] = [];
  let remaining = budgetBytes;

  for (const mention of mentions) {
    const resolved = resolve(mention, root);
    if ("reason" in resolved) {
      skipped.push({ mention, reason: resolved.reason });
      continue;
    }
    let raw: Buffer;
    try {
      raw = fs.readFileSync(resolved.absolute);
    } catch (error) {
      skipped.push({ mention, reason: `unreadable (${String(error)})` });
      continue;
    }
    if (looksBinary(raw)) {
      skipped.push({ mention, reason: "looks binary" });
      continue;
    }
    if (remaining <= 0) {
      skipped.push({ mention, reason: "no budget left for inlining" });
      continue;
    }

    const truncated = raw.byteLength > remaining;
    const content = truncated
      ? raw.subarray(0, remaining).toString("utf-8") +
        "\n… [truncated: file is larger than the inlining budget]"
      : raw.toString("utf-8");
    remaining -= Math.min(raw.byteLength, remaining);

    const language = FENCE_LANGUAGE[path.extname(resolved.relative)] ?? "";
    blocks.push(
      `### ${resolved.relative}\n\`\`\`${language}\n${content}\n\`\`\``,
    );
    files.push({
      path: resolved.relative,
      bytes: raw.byteLength,
      truncated,
    });
  }

  const block =
    blocks.length === 0
      ? ""
      : `---\nThe files referenced above are included in full below.\n\n${blocks.join("\n\n")}`;
  return { block, files, skipped };
}

/** Convenience wrapper: find this text's own mentions and inline them. */
export function expandMentions(
  text: string,
  root: string = process.cwd(),
  budgetBytes: number = DEFAULT_BUDGET_BYTES,
): Expansion {
  const { block, files, skipped } = inlineFiles(
    findMentions(text),
    root,
    budgetBytes,
  );
  // The files go AFTER the question. The question is what the model is being
  // asked to do, and burying it under 40 KB of source is how it gets lost.
  return {
    text: block ? `${text}\n\n${block}` : text,
    files,
    skipped,
  };
}
