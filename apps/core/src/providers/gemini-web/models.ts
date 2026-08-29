// =============================================================================
// Gemini web session — model table
//
// `mode` is the MODE_CATEGORY enum the web client sends in payload slot 79:
//   1=FAST  2=THINKING  3=PRO  4=AUTO  5=FAST_DYNAMIC_THINKING  6=FLASH_LITE
// `think` is the thinking depth in slot 17, where 0 is deepest and 4 shallowest.
//
// These are the web UI's own ids, not the public API's, and they move when
// Google ships a new front end. An unknown name falls back to the default
// rather than erroring: a stale id in someone's config should degrade to a
// working model, not to a dead session.
// =============================================================================

export interface GeminiWebModel {
  mode: number;
  think: number;
  description: string;
}

export const MODELS: Record<string, GeminiWebModel> = {
  "gemini-3.7-flash": { mode: 1, think: 4, description: "Latest all-around" },
  "gemini-3.6-flash": { mode: 1, think: 4, description: "All-around" },
  "gemini-3.5-flash": { mode: 1, think: 4, description: "Alias of 3.6 flash" },
  "gemini-3.5-flash-thinking": {
    mode: 2,
    think: 0,
    description: "Deep thinking, longest output",
  },
  "gemini-3.5-flash-thinking-lite": {
    mode: 5,
    think: 0,
    description: "Adaptive thinking depth",
  },
  "gemini-3.1-pro": {
    mode: 3,
    think: 4,
    description: "Pro — needs a Gemini Advanced cookie to route as Pro",
  },
  "gemini-auto": { mode: 4, think: 4, description: "Auto model selection" },
  "gemini-flash-lite": { mode: 6, think: 4, description: "Lightweight, fast" },
};

export const DEFAULT_MODEL = "gemini-3.5-flash-thinking";

export interface ResolvedModel {
  name: string;
  mode: number;
  think: number;
}

/** Resolves a model name, honouring a `@think=N` suffix. */
export function resolveGeminiWebModel(requested?: string): ResolvedModel {
  let name = requested || DEFAULT_MODEL;
  let thinkOverride: number | undefined;

  const at = name.lastIndexOf("@think=");
  if (at !== -1) {
    const parsed = Number.parseInt(name.slice(at + 7), 10);
    if (Number.isInteger(parsed) && parsed >= 0 && parsed <= 4) {
      thinkOverride = parsed;
    }
    name = name.slice(0, at);
  }

  const config = MODELS[name] ?? MODELS[DEFAULT_MODEL];
  return {
    name: MODELS[name] ? name : DEFAULT_MODEL,
    mode: config.mode,
    think: thinkOverride ?? config.think,
  };
}
