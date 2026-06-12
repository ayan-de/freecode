const CHARS_PER_TOKEN = 4;

export const MODEL_CONTEXT_LIMITS: Record<string, number> = {
  "gpt-4o": 128_000,
  "gpt-4-turbo": 128_000,
  "gpt-4": 8_192,
  "gpt-3.5-turbo": 16_385,
  "claude-3-5-sonnet": 200_000,
  "claude-3-opus": 200_000,
  "claude-3-sonnet": 200_000,
  "gemini-1.5-pro": 1_000_000,
  "gemini-1.5-flash": 1_000_000,
  default: 100_000,
};

export function estimateTokenCount(text: string): number {
  if (text.length === 0) return 0;
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

export function getContextLimit(model: string): number {
  return MODEL_CONTEXT_LIMITS[model] ?? MODEL_CONTEXT_LIMITS.default;
}

export function getAutoCompactThreshold(
  model: string,
  bufferTokens: number,
): number {
  return Math.max(0, getContextLimit(model) - bufferTokens);
}

export function shouldCompact(
  tokenCount: number,
  model: string,
  bufferTokens: number,
): boolean {
  return tokenCount >= getAutoCompactThreshold(model, bufferTokens);
}
