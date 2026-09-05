export const DEFAULT_UPSTREAM = "https://api.minimax.io/anthropic";

/**
 * Point every current adapter at the recording proxy.
 *
 * Claude Code reads `ANTHROPIC_BASE_URL` (no `/v1` suffix — it adds it).
 * Freecode's MiniMax SDK is constructed with the catalogue URL
 * (`.../anthropic/v1`), so `MINIMAX_BASE_URL` carries that suffix.
 */
export function meterEnv(origin: string): Record<string, string> {
  const base = origin.replace(/\/$/, "");
  return {
    ANTHROPIC_BASE_URL: base,
    MINIMAX_BASE_URL: `${base}/v1`,
  };
}

export function upstreamFor(spec: { env?: Record<string, string> }): string {
  const raw = spec.env?.ANTHROPIC_BASE_URL;
  if (raw && raw.startsWith("http") && !raw.includes("${")) return raw;
  return DEFAULT_UPSTREAM;
}
