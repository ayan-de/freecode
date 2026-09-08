// =============================================================================
// Project Instructions Loader
// Reads user-authored instruction files into the system prompt.
// Per location, CLAUDE.md wins over AGENTS.md (first non-empty match only).
// Locations, in prompt order: global (~/.freecode/), then project root.
// ponytail: root-level files only; walk-up hierarchy / @imports deferred
// until monorepo users ask (see plan doc Notes).
// =============================================================================

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { logger } from "../utils/logger.js";

const INSTRUCTION_FILES = ["CLAUDE.md", "AGENTS.md"];
const MAX_INSTRUCTIONS_CHARS = 40_000;
/**
 * Below this a surviving block is a header and a sentence fragment — worse than
 * an honest note that it was dropped, because a truncated rule reads as a rule.
 */
const MIN_USEFUL_BLOCK_CHARS = 400;
const SEPARATOR = "\n\n";

function readFirstMatch(
  dir: string,
): { path: string; content: string } | undefined {
  for (const name of INSTRUCTION_FILES) {
    const filePath = path.join(dir, name);
    try {
      const content = fs.readFileSync(filePath, "utf-8").trim();
      if (content) return { path: filePath, content };
    } catch {
      // missing/unreadable — try the next candidate
    }
  }
  return undefined;
}

/**
 * Render the project-instructions section for the system prompt.
 * Returns "" when no instruction files exist.
 */
export function compileInstructionsSection(
  projectPath: string,
  globalDir: string = path.join(os.homedir(), ".freecode"),
): string {
  const found = [readFirstMatch(globalDir), readFirstMatch(projectPath)].filter(
    (f): f is { path: string; content: string } => f !== undefined,
  );
  if (found.length === 0) return "";

  const blocks = found.map((f) => ({
    path: f.path,
    text: `Instructions from: ${f.path}\n${f.content}`,
  }));

  const total =
    blocks.reduce((n, b) => n + b.text.length, 0) +
    SEPARATOR.length * (blocks.length - 1);
  if (total <= MAX_INSTRUCTIONS_CHARS) {
    return blocks.map((b) => b.text).join(SEPARATOR);
  }

  // Over budget. Allocate MOST SPECIFIC FIRST — the project's file is the one
  // that describes the code being worked on, and a fat ~/.freecode/CLAUDE.md
  // must not be able to push it out.
  //
  // The previous implementation joined global-then-project and sliced the
  // JOINED string at 40k, so a global file at the cap deleted this repo's
  // instructions entirely, mid-sentence, with a marker that named no file. The
  // agent then followed generic instructions and nothing said why.
  const rendered = new Map<string, string>();
  let remaining = MAX_INSTRUCTIONS_CHARS;
  for (const block of [...blocks].reverse()) {
    const cost = block.text.length + (rendered.size > 0 ? SEPARATOR.length : 0);
    if (cost <= remaining) {
      rendered.set(block.path, block.text);
      remaining -= cost;
      continue;
    }
    const room = remaining - (rendered.size > 0 ? SEPARATOR.length : 0);
    if (room >= MIN_USEFUL_BLOCK_CHARS) {
      const marker = `\n[Truncated: ${block.path} did not fit the ${MAX_INSTRUCTIONS_CHARS}-character instruction budget]`;
      rendered.set(
        block.path,
        block.text.slice(0, Math.max(0, room - marker.length)) + marker,
      );
      logger.warn(
        `[Instructions] Truncated ${block.path}: the ${MAX_INSTRUCTIONS_CHARS}-character budget was already spent by more specific instruction files.`,
      );
    } else {
      // Never silent: the model is told the file exists and was dropped, so a
      // rule that goes unfollowed has a visible cause. This note can push the
      // section a hundred-odd characters past the cap, which is the right
      // trade — the cap is a soft budget, and the alternative is the silent
      // drop this whole branch exists to prevent.
      rendered.set(
        block.path,
        `Instructions from: ${block.path}\n[Omitted: the ${MAX_INSTRUCTIONS_CHARS}-character instruction budget was exhausted by more specific instruction files.]`,
      );
      logger.warn(
        `[Instructions] Omitted ${block.path} entirely: the ${MAX_INSTRUCTIONS_CHARS}-character budget was already spent by more specific instruction files.`,
      );
    }
    remaining = 0;
  }

  // Emit in prompt order (global, then project) regardless of allocation order.
  return blocks
    .map((b) => rendered.get(b.path))
    .filter((text): text is string => text !== undefined)
    .join(SEPARATOR);
}
