// =============================================================================
// Gemini web session — settings
//
// Everything here is OPTIONAL. Anonymous access works for the flash-tier
// models, which is the whole point: no key, no account, no setup. A cookie only
// buys `gemini-3.1-pro` real Pro routing (and only on a Gemini Advanced
// account — a free account authenticates and then silently serves Flash).
//
// Read from ~/.freecode/config.json under web["gemini-web"] (and still under
// providers["gemini-web"], where this was documented before the `web` block
// existed — see readWebCredential):
//   { "cookie": "SID=…; SAPISID=…", "cookieFile": "/path", "authUser": "1",
//     "xsrfToken": "AOOh0P…" }
// =============================================================================

import * as fs from "fs";
import { readWebCredential } from "../config.js";

export interface GeminiWebSettings {
  /** Raw Cookie header value, or "" for anonymous. */
  cookie: string;
  /** SAPISID, needed for the Authorization hash. Derived from the cookie. */
  sapisid?: string;
  /** Google account index, when the signed-in URL is /u/<n>/app. */
  authUser?: string;
  /** Page XSRF token (`SNlM0e`), sent as the `at` form field. */
  xsrfToken?: string;
  /** The text-protocol tool bridge (tool-bridge.ts). ON by default since
   *  2026-09-05 (spec §10.4): a fresh install picking gemini-web from /web
   *  gets working tools with nothing to configure. Opt OUT with
   *  `experimentalTools: false` or FREECODE_GEMINI_WEB_TOOLS=0; the env var
   *  outranks config either way (=1 forces on), so a broken bridge can be
   *  toggled without editing config.json. */
  experimentalTools: boolean;
}

interface RawSettings {
  cookie?: string;
  cookieFile?: string;
  authUser?: string | number;
  xsrfToken?: string;
  experimentalTools?: boolean;
}

function sapisidFrom(cookie: string): string | undefined {
  for (const pair of cookie.split(";")) {
    const [name, ...rest] = pair.trim().split("=");
    if (name === "SAPISID" && rest.length > 0) return rest.join("=");
  }
  return undefined;
}

/** A cookie file is either a raw Cookie header line or {"cookie","sapisid"}. */
function readCookieFile(file: string): string {
  try {
    const content = fs.readFileSync(file, "utf-8").trim();
    if (!content.startsWith("{")) return content;
    const parsed = JSON.parse(content) as { cookie?: string };
    return parsed.cookie ?? "";
  } catch {
    // A missing or malformed cookie file degrades to anonymous rather than
    // failing the session: anonymous still answers on every flash model.
    return "";
  }
}

export function loadGeminiWebSettings(): GeminiWebSettings {
  const raw = readWebCredential("gemini-web") as unknown as RawSettings;

  const cookie = raw.cookie?.trim()
    ? raw.cookie.trim()
    : raw.cookieFile
      ? readCookieFile(raw.cookieFile)
      : "";

  return {
    cookie,
    sapisid: cookie ? sapisidFrom(cookie) : undefined,
    authUser:
      raw.authUser === undefined || raw.authUser === ""
        ? undefined
        : String(raw.authUser),
    xsrfToken: raw.xsrfToken || undefined,
    experimentalTools:
      process.env.FREECODE_GEMINI_WEB_TOOLS === "0"
        ? false
        : process.env.FREECODE_GEMINI_WEB_TOOLS === "1"
          ? true
          : raw.experimentalTools !== false,
  };
}
