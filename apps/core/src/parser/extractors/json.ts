// =============================================================================
// JSON Extractor
// Matches { "changes": [{ "path": "...", "content": "..." }] }
// =============================================================================

import type { ParserStrategy, ParserResult, FileChange } from "../types.js";

export class JsonExtractor implements ParserStrategy {
  name = "json";

  parse(raw: string): ParserResult {
    // Try to find a JSON object with changes array
    const jsonMatch = raw.match(/\{[\s\S]*"changes"\s*:\s*\[[\s\S]*\]/);
    if (!jsonMatch) {
      return { success: false, error: "No JSON changes structure found" };
    }

    try {
      const parsed = JSON.parse(jsonMatch[0]);
      const changes: FileChange[] = [];

      if (Array.isArray(parsed.changes)) {
        for (const item of parsed.changes) {
          if (item.path) {
            changes.push({
              path: item.path,
              action: item.action || "create",
              content: item.content,
            });
          }
        }
      }

      if (changes.length === 0) {
        return { success: false, error: "No valid changes found in JSON" };
      }

      return {
        success: true,
        response: {
          summary: parsed.summary || "Files from JSON",
          changes,
          raw,
          parserUsed: this.name,
        },
      };
    } catch {
      return { success: false, error: "Failed to parse JSON" };
    }
  }
}
