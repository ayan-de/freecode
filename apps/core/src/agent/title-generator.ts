// =============================================================================
// Session Title Generator
// PRIMARY: Generate a concise title from the first user prompt
// Uses a fast/small model (Haiku-tier) for title generation
// =============================================================================

import { getProvider } from "../providers/index.js";
import type { ProviderId } from "../providers/index.js";

const TITLE_PROMPT_TEMPLATE = `Generate a concise title (3-5 words) that captures the main topic or goal of this coding session.

Requirements:
- Use sentence-case (only first word capitalized)
- 3-5 words maximum
- Focus on the action or subject, not generic words like "session" or "coding"
- No quotes or special formatting

Examples:
- "Add user authentication" (not "User Authentication" or "Add user authentication to the app")
- "Fix memory leak in agent loop"
- "Implement session resume feature"
- "Refactor provider adapter"

Session prompt:
"""

{prompt}
"""

Title:`;

interface GenerateTitleOptions {
  prompt: string;
  provider: string;
  model?: string;
}

/**
 * Generate a session title from the first user prompt.
 * Uses the provider's fastest model (Haiku-tier equivalent).
 */
export async function generateSessionTitle(
  opts: GenerateTitleOptions,
): Promise<string> {
  try {
    const provider = getProvider(opts.provider as ProviderId);
    if (!provider) {
      return generateTitleFromPrompt(opts.prompt);
    }

    // Use a fast, cheap model for title generation
    const titleModel = opts.model ? extractSmallModel(opts.model) : undefined;

    const result = await provider.execute({
      prompt: TITLE_PROMPT_TEMPLATE.replace(
        "{prompt}",
        opts.prompt.slice(0, 500),
      ),
      system:
        "You are a helpful assistant that generates concise session titles.",
      model: titleModel,
      maxTokens: 20,
    });

    const title = result.content.trim();
    if (title && title.length >= 3 && title.length <= 60) {
      return normalizeTitle(title);
    }

    return generateTitleFromPrompt(opts.prompt);
  } catch (error) {
    console.warn("[TitleGenerator] Failed to generate title:", error);
    return generateTitleFromPrompt(opts.prompt);
  }
}

/**
 * Extract a smaller/faster model name from a model string.
 * For example, "MiniMax-M2" stays "MiniMax-M2" but could map to "MiniMax-Haiku"
 */
function extractSmallModel(model: string): string | undefined {
  // If the model already indicates a small/fast variant, use it
  if (
    model.toLowerCase().includes("haiku") ||
    model.toLowerCase().includes("mini")
  ) {
    return model;
  }
  // Otherwise, append -haiku or similar to indicate smaller model
  // This is provider-specific and may need adjustment
  return undefined; // Let provider decide default fast model
}

/**
 * Normalize the generated title.
 * - Trim whitespace
 * - Remove quotes
 * - Ensure sentence case
 */
function normalizeTitle(title: string): string {
  let cleaned = title.trim();
  // Remove surrounding quotes if present
  if (
    (cleaned.startsWith('"') && cleaned.endsWith('"')) ||
    (cleaned.startsWith("'") && cleaned.endsWith("'"))
  ) {
    cleaned = cleaned.slice(1, -1);
  }
  // Remove any newlines or weird formatting
  cleaned = cleaned.replace(/\n/g, " ").replace(/\s+/g, " ").trim();
  // Ensure sentence case (first letter capital, rest lowercase)
  if (cleaned.length > 0) {
    cleaned = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
  }
  // Truncate if too long
  if (cleaned.length > 50) {
    cleaned = cleaned.slice(0, 47) + "...";
  }
  return cleaned;
}

/**
 * Generate a fallback title from the prompt when LLM doesn't provide one.
 * Filters out stop words and returns first 5 meaningful words.
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
