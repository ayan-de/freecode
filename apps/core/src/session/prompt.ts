// =============================================================================
// Provider Prompts Loader
// Loads provider-specific system prompts from session/prompt/*.txt files
// Provider selection based on model ID patterns
// =============================================================================

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Provider prompt file mappings
const PROMPT_FILES: Record<string, string> = {
  // Order matters - more specific patterns first
  claude: "anthropic.txt",
  "gpt-4": "gpt.txt",
  gpt: "openai.txt",
  chatgpt: "chatgpt.txt",
  gemini: "gemini.txt",
  default: "default.txt", // fallback
};

// Default fallback prompt file
const DEFAULT_PROMPT = "default.txt";

// Prompts directory - the .txt files are in a subdirectory
function getPromptsDir(): string {
  return path.join(__dirname, "prompt");
}

/**
 * Select the appropriate prompt file based on provider/model ID
 */
function selectPromptFile(modelId: string): string {
  const normalized = modelId.toLowerCase();

  for (const [pattern, file] of Object.entries(PROMPT_FILES)) {
    if (pattern !== "default" && normalized.includes(pattern)) {
      return file;
    }
  }

  return DEFAULT_PROMPT;
}

/**
 * Load a provider prompt from the session/prompt directory
 */
export function loadProviderPrompt(modelId: string): string {
  const fileName = selectPromptFile(modelId);
  const filePath = path.join(getPromptsDir(), fileName);

  try {
    if (fs.existsSync(filePath)) {
      return fs.readFileSync(filePath, "utf-8");
    }
  } catch (error) {
    console.warn(`[ProviderPrompts] Failed to load ${filePath}: ${error}`);
  }

  // Fallback to default if file not found
  const defaultPath = path.join(getPromptsDir(), DEFAULT_PROMPT);
  try {
    if (fs.existsSync(defaultPath)) {
      return fs.readFileSync(defaultPath, "utf-8");
    }
  } catch (error) {
    console.warn(`[ProviderPrompts] Failed to load default prompt: ${error}`);
  }

  // Ultimate fallback - return embedded minimal prompt
  return "You are FreeCode, an AI coding assistant. Complete the user's task.";
}

/**
 * Get the path to a specific provider prompt file
 */
export function getPromptPath(modelId: string): string {
  return path.join(getPromptsDir(), selectPromptFile(modelId));
}

/**
 * List available provider prompts
 */
export function listAvailablePrompts(): string[] {
  const dir = getPromptsDir();
  try {
    const files = fs.readdirSync(dir);
    return files.filter((f) => f.endsWith(".txt"));
  } catch {
    return [];
  }
}
