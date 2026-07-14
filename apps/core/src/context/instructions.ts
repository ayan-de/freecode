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

const INSTRUCTION_FILES = ["CLAUDE.md", "AGENTS.md"];
const MAX_INSTRUCTIONS_CHARS = 40_000;

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

  let section = found
    .map((f) => `Instructions from: ${f.path}\n${f.content}`)
    .join("\n\n");
  if (section.length > MAX_INSTRUCTIONS_CHARS) {
    section =
      section.slice(0, MAX_INSTRUCTIONS_CHARS) +
      `\n[Instructions truncated at ${MAX_INSTRUCTIONS_CHARS} characters]`;
  }
  return section;
}
