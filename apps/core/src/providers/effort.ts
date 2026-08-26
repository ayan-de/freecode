import type { EffortLevel } from "./types.js";

// All three SDKs happen to accept the same "low"|"medium"|"high" strings
// natively, just under different keys — so no numeric budget translation
// is needed, only routing to the right providerOptions slot.
export function applyEffort(
  generateOptions: { providerOptions?: Record<string, unknown> },
  providerId: "anthropic" | "openai" | "gemini",
  effort: EffortLevel | undefined,
): void {
  if (!effort) return;
  const providerOptions = { ...generateOptions.providerOptions };
  switch (providerId) {
    case "anthropic":
      providerOptions.anthropic = { ...(providerOptions.anthropic as object), effort };
      break;
    case "openai":
      providerOptions.openai = {
        ...(providerOptions.openai as object),
        reasoningEffort: effort,
      };
      break;
    case "gemini": {
      // thinkingLevel tops out at "high" — clamp the Anthropic/OpenAI-only
      // xhigh/max tiers rather than sending a value the API will reject.
      const thinkingLevel = effort === "xhigh" || effort === "max" ? "high" : effort;
      providerOptions.google = {
        ...(providerOptions.google as object),
        thinkingConfig: { thinkingLevel },
      };
      break;
    }
  }
  generateOptions.providerOptions = providerOptions;
}
