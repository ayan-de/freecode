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

/**
 * What signing in to a web session costs the user, declared here so the picker
 * can prompt for it without knowing anything about the provider. Frontends
 * render; they do not carry a table of which provider wants a cookie.
 */
export interface WebCredentialSpec {
  /** Field under `web.<id>` the pasted value is written to. */
  field: "cookie" | "apiKey";
  /** Noun for the prompt — "cookie", "session token". */
  label: string;
  /** Where to get it, and what it buys. Shown under the prompt. */
  hint: string;
  /**
   * Whether the session is unusable without it. False for a session that works
   * anonymously: a missing optional credential is not a misconfiguration, and
   * reporting it as one sends the user hunting for something they don't need.
   */
  required: boolean;
}

export interface WebProvider extends Provider {
  credential: WebCredentialSpec;
}

export const LOCAL_PROVIDERS: WebProvider[] = [
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
    credential: {
      field: "cookie",
      label: "cookie",
      hint:
        "gemini.google.com → DevTools → Application → Cookies → copy the " +
        "whole Cookie header (must include SAPISID). Optional: it only buys " +
        "gemini-3.1-pro real Pro routing, and needs a Gemini Advanced " +
        "account. Every flash model already works anonymously.",
      required: false,
    },
  },
];

export function localProvider(id: string): WebProvider | undefined {
  return LOCAL_PROVIDERS.find((p) => p.id === id);
}
