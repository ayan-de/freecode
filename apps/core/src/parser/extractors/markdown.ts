// =============================================================================
// Markdown Extractor
// Matches code blocks without FILE: prefix
// =============================================================================

import type { ParserStrategy, ParserResult, FileChange } from "../types.js";

export class MarkdownExtractor implements ParserStrategy {
  name = "markdown";

  parse(raw: string): ParserResult {
    const changes: FileChange[] = [];

    // Match code blocks with language hint (e.g. ```typescript filename.ts)
    const namedCodeBlock = /```[\w]*\s*([^\n\t]+?)\n([\s\S]*?)```/g;
    let match;
    while ((match = namedCodeBlock.exec(raw)) !== null) {
      const filename = match[1].trim();
      const content = match[2].trim();

      // Skip if it doesn't look like a filename
      if (filename && !filename.startsWith("#") && content.length > 5) {
        changes.push({ path: filename, action: "create", content });
      }
    }

    if (changes.length === 0) {
      return { success: false, error: "No markdown code blocks found" };
    }

    return {
      success: true,
      response: {
        summary: "Files from markdown code blocks",
        changes,
        raw,
        parserUsed: this.name,
      },
    };
  }
}
