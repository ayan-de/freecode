// =============================================================================
// MiniMax web session — model table
//
// The web agent exposes a single model and picks routing itself; there is no
// mode/think selector like Gemini's. Kept as a table anyway so the picker has
// something to list and a second model is a one-line change.
// =============================================================================

export const MODELS: Record<string, { description: string }> = {
  "MiniMax-M2.7": { description: "MiniMax Agent (web)" },
};

export const DEFAULT_MODEL = "MiniMax-M2.7";
