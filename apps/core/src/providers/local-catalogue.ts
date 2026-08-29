// =============================================================================
// Providers models.dev cannot know about.
//
// `providers.list` and `models.list` are served from the models.dev catalogue,
// which indexes public metered APIs. A provider that drives a web session has
// no entry there and never will, so without this it is invisible in the model
// picker and can only be selected by hand-editing config.json.
//
// Kept as data rather than derived from the registry because the registry
// stores one default model per provider, and a picker needs the whole list.
// =============================================================================

import type { Provider } from "../models-dev.js";
import { MODELS } from "./gemini-web/models.js";

export const LOCAL_PROVIDERS: Provider[] = [
  {
    id: "gemini-web",
    name: "Gemini (web session)",
    description:
      "Ask/review over a gemini.google.com session. No API key. Reads files " +
      "you @mention; cannot edit, run commands, or search.",
    models: Object.entries(MODELS).map(([id, model]) => ({
      id,
      name: id,
      description: model.description,
    })),
  },
];

export function localProvider(id: string): Provider | undefined {
  return LOCAL_PROVIDERS.find((p) => p.id === id);
}
