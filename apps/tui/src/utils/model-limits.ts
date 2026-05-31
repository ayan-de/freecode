/**
 * Model context and output limits.
 * Values are token counts for the model's context window and max output.
 */

export interface ModelLimits {
  context: number;
  output: number;
}

// Known model limits by model ID (provider/model-name format)
export const MODEL_LIMITS: Record<string, ModelLimits> = {
  // MiniMax models
  "minimax/MiniMax-M2": { context: 1_000_000, output: 8192 },
  "minimax/minimax-text-01": { context: 1_000_000, output: 8192 },
  "minimax/minimax-text-01-prefill": { context: 1_000_000, output: 8192 },
  "minimax/agent-minimax-text-01": { context: 1_000_000, output: 8192 },

  // OpenAI models
  "openai/gpt-4o": { context: 128_000, output: 16384 },
  "openai/gpt-4o-mini": { context: 128_000, output: 16384 },
  "openai/gpt-4-turbo": { context: 128_000, output: 4096 },
  "openai/gpt-3.5-turbo": { context: 16_385, output: 4096 },

  // Anthropic models
  "anthropic/claude-sonnet-4-20250514": { context: 200_000, output: 8192 },
  "anthropic/claude-opus-4-20250514": { context: 200_000, output: 8192 },
  "anthropic/claude-3-5-sonnet-latest": { context: 200_000, output: 8192 },
  "anthropic/claude-3-opus-latest": { context: 200_000, output: 4096 },
  "anthropic/claude-3-sonnet-latest": { context: 200_000, output: 4096 },
  "anthropic/claude-3-haiku-latest": { context: 200_000, output: 4096 },

  // Google models
  "google/gemini-2.0-flash": { context: 1_000_000, output: 8192 },
  "google/gemini-1.5-pro": { context: 2_000_000, output: 8192 },
  "google/gemini-1.5-flash": { context: 1_000_000, output: 8192 },

  // GitHub Copilot
  "github-copilot/gpt-4o": { context: 128_000, output: 4096 },
  "github-copilot/gpt-4o-mini": { context: 128_000, output: 4096 },
};

/**
 * Get context limit for a model. Returns 0 if unknown.
 */
export function getModelContextLimit(modelId: string): number {
  return MODEL_LIMITS[modelId]?.context ?? 0;
}

/**
 * Get output limit for a model. Returns 0 if unknown.
 */
export function getModelOutputLimit(modelId: string): number {
  return MODEL_LIMITS[modelId]?.output ?? 0;
}
