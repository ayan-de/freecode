// =============================================================================
// Browser Chat — chatgpt.com adapter
//
// UNVALIDATED against the live site — written from the publicly documented
// shape of chatgpt.com's streaming protocol, not from a captured fixture (the
// way sites/claude.ts was). ChatGPT streams a sequence of JSON-Patch-shaped
// ops against a server-side document rather than flat `{delta:{text}}`
// chunks; only "append" ops on the message body carry assistant text, so that
// is the only op this adapter treats as a delta. Everything else (resumed
// state, metadata patches) is ignored on purpose rather than guessed at.
//
// Run `freecode browser doctor --site chatgpt --raw` against a real signed-in
// tab and fix whatever it reports before trusting this in production; capture
// a fixture with `freecode browser capture --site chatgpt` once it works so a
// future site change fails a test instead of failing silently.
// =============================================================================

import type { RawChunk } from "../transport/types.js";
import type { SiteAdapter } from "./types.js";
import type { SseFrame } from "./sse.js";
import { parseFrameJson } from "./sse.js";

const RATE_LIMIT = /usage cap|rate.?limit|too many requests|message limit/i;

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

/** One patch op's text, or null if this op is not an append of a string. */
function appendedText(op: unknown): string | null {
  const record = asRecord(op);
  if (!record || record.o !== "append") return null;
  return typeof record.v === "string" ? record.v : null;
}

/**
 * Handles both shapes seen in the op protocol: a single op at the frame's
 * top level, and a "patch" op batching several ops in `v`.
 */
function extractDelta(payload: unknown): string | null {
  const root = asRecord(payload);
  if (!root) return null;

  const direct = appendedText(root);
  if (direct !== null) return direct;

  if (root.o === "patch" && Array.isArray(root.v)) {
    const parts = root.v
      .map(appendedText)
      .filter((t): t is string => t !== null);
    if (parts.length > 0) return parts.join("");
  }

  return null;
}

function extractLimit(payload: unknown): RawChunk | null {
  const root = asRecord(payload);
  if (!root || root.error == null) return null;

  const errorRecord = asRecord(root.error);
  const detail =
    typeof root.error === "string"
      ? root.error
      : (typeof errorRecord?.message === "string" && errorRecord.message) ||
        JSON.stringify(root.error).slice(0, 300);

  if (RATE_LIMIT.test(detail)) {
    return { type: "limit", kind: "rate_limited", detail };
  }
  return { type: "error", message: detail };
}

export const chatgptAdapter: SiteAdapter = {
  id: "chatgpt",
  label: "ChatGPT (chatgpt.com)",
  adapterVersion: "0.1.0",

  newChatUrl: () => "https://chatgpt.com/",

  completionUrlPatterns: ["/backend-api/conversation"],

  composerSelectors: [
    "#prompt-textarea",
    'div[contenteditable="true"]#prompt-textarea',
    'div[contenteditable="true"]',
  ],

  submitSelectors: [
    'button[data-testid="send-button"]',
    'button[aria-label="Send prompt"]',
    'button[aria-label*="Send" i]',
  ],

  decodeFrame(frame: SseFrame): RawChunk | null {
    const payload = parseFrameJson(frame);
    if (payload === null) return null;

    const limit = extractLimit(payload);
    if (limit) return limit;

    const text = extractDelta(payload);
    if (text !== null && text.length > 0) return { type: "delta", text };

    return null;
  },
};
