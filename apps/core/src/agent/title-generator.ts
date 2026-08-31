// =============================================================================
// Session Title Generator
// Fallback title derived from the first user prompt (no model call).
// =============================================================================

/**
 * Generate a fallback title from the prompt when the model doesn't provide
 * a `SESSION_TITLE:` line. Filters out stop words and returns the first 5
 * meaningful words.
 */
export function generateTitleFromPrompt(prompt: string): string {
  const stopWords = new Set([
    "please",
    "can",
    "could",
    "would",
    "help",
    "me",
    "with",
    "the",
    "a",
    "an",
    "to",
    "for",
    "and",
    "in",
    "on",
  ]);

  const words = prompt
    .replace(/[^\w\s-]/g, "")
    .split(/\s+/)
    .filter((word) => word.length > 2)
    .filter((word) => !stopWords.has(word.toLowerCase()));

  return words.slice(0, 5).join(" ");
}
