// =============================================================================
// Gemini web session — request construction
//
// Speaks Google's internal batchexecute RPC
// (assistant.lamda.BardFrontendService/StreamGenerate) the way the web client
// does: a form-encoded `f.req` holding a JSON array of ~102 positional slots.
// The slots are unnamed by construction, so every one set below is annotated —
// an unlabelled magic index is unmaintainable the first time the shape moves.
//
// Slot 2 is left as empty conversation/response/choice ids on purpose. That
// makes every request a fresh chat, and is why the provider re-sends history as
// text instead of tracking a server-side thread: the thread is real (the reply
// carries c_/r_ ids) but relying on it would mean the site owning conversation
// state we cannot inspect, resume, fork or export the way sessions expect.
// =============================================================================

import { createHash, randomUUID } from "crypto";
import type { GeminiWebSettings } from "./settings.js";

const ORIGIN = "https://gemini.google.com";
// Matches what the web client sends; not an attempt to look like anything we
// are not, and deliberately not rotated or randomised.
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";

function accountPrefix(settings: GeminiWebSettings): string {
  return settings.authUser ? `/u/${settings.authUser}` : "";
}

/**
 * Google's SAPISIDHASH scheme: sha1("<unix seconds> <SAPISID> <origin>").
 * Only used when the user supplied a cookie; anonymous requests send neither
 * this nor a Cookie header.
 */
export function sapisidHash(sapisid: string, nowMs: number = Date.now()): string {
  const ts = Math.floor(nowMs / 1000);
  const digest = createHash("sha1")
    .update(`${ts} ${sapisid} ${ORIGIN}`)
    .digest("hex");
  return `SAPISIDHASH ${ts}_${digest}`;
}

export function buildHeaders(
  settings: GeminiWebSettings,
): Record<string, string> {
  const prefix = accountPrefix(settings);
  const headers: Record<string, string> = {
    "Content-Type": "application/x-www-form-urlencoded",
    Origin: ORIGIN,
    Referer: `${ORIGIN}${prefix}/app`,
    "X-Same-Domain": "1",
    "User-Agent": USER_AGENT,
  };
  if (settings.authUser) headers["X-Goog-AuthUser"] = settings.authUser;
  if (settings.cookie) headers.Cookie = settings.cookie;
  if (settings.sapisid) headers.Authorization = sapisidHash(settings.sapisid);
  return headers;
}

export function requestUrl(
  buildLabel: string,
  settings: GeminiWebSettings,
): string {
  const reqid = Math.floor(Date.now() / 1000) % 1_000_000;
  return (
    `${ORIGIN}${accountPrefix(settings)}/_/BardChatUi/data/` +
    `assistant.lamda.BardFrontendService/StreamGenerate` +
    `?bl=${encodeURIComponent(buildLabel)}&hl=en&_reqid=${reqid}&rt=c`
  );
}

export interface PayloadOptions {
  prompt: string;
  /** MODE_CATEGORY (slot 79). */
  mode: number;
  /** Thinking depth (slot 17), 0 deepest .. 4 shallowest. */
  think: number;
}

export function buildPayload(
  options: PayloadOptions,
  settings: GeminiWebSettings,
): string {
  const inner: unknown[] = new Array(102).fill(null);
  inner[0] = [options.prompt, 0, null, null, null, null, 0]; // the message
  inner[1] = ["en"]; // language
  inner[2] = ["", "", "", null, null, null, null, null, null, ""]; // ids — see header
  inner[6] = [0];
  inner[7] = 1;
  inner[10] = 1;
  inner[11] = 0;
  inner[17] = [[options.think]];
  inner[18] = 0;
  inner[27] = 1;
  inner[30] = [4];
  inner[41] = [2]; // persist to history (1 + slot 45 would be a temporary chat)
  inner[53] = 0;
  inner[59] = randomUUID();
  inner[61] = [];
  inner[68] = 1;
  inner[79] = options.mode;

  const form = new URLSearchParams({
    "f.req": JSON.stringify([null, JSON.stringify(inner)]),
  });
  // Authenticated requests are rejected without the page's XSRF token; the
  // anonymous path never needs it.
  if (settings.xsrfToken) form.set("at", settings.xsrfToken);
  return form.toString();
}

export { USER_AGENT, ORIGIN };
