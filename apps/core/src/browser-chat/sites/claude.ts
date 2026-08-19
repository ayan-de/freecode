// =============================================================================
// Browser Chat — claude.ai adapter
//
// VALIDATED against the live site on 2026-08-20 via the extension transport;
// frame decoding is covered by sites/fixtures/claude-hello.txt. Selectors are
// confirmed by a real send. Capture a new fixture with
// `freecode browser capture` whenever the site's payloads change.
// =============================================================================

import type { RawChunk } from "../transport/types.js";
import type { SiteAdapter } from "./types.js";
import type { SseFrame } from "./sse.js";
import { parseFrameJson } from "./sse.js";

const RATE_LIMIT = /rate.?limit|usage limit|message limit|out of messages/i;
const THREAD_FULL = /maximum length|conversation is too long|too long to continue/i;

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * Known text-carrying shapes, tried in order. Kept deliberately small — a
 * speculative path that matches the wrong field would inject garbage into the
 * model's reply, which is worse than decoding nothing and saying so.
 */
function extractText(payload: unknown): string | null {
  const root = asRecord(payload);
  if (!root) return null;

  // Anthropic-style streaming: { type: "content_block_delta", delta: { text } }
  const delta = asRecord(root.delta);
  if (delta && typeof delta.text === "string") return delta.text;

  // Flat completion field: { completion: "..." }
  if (typeof root.completion === "string") return root.completion;

  // Plain text field, only when this is not an error envelope.
  if (typeof root.text === "string" && !root.error) return root.text;

  return null;
}

function extractLimit(payload: unknown): RawChunk | null {
  const root = asRecord(payload);
  if (!root) return null;
  const error = asRecord(root.error) ?? (root.type === "error" ? root : null);
  if (!error) return null;

  const detail =
    (typeof error.message === "string" && error.message) ||
    (typeof root.message === "string" && root.message) ||
    JSON.stringify(error).slice(0, 300);

  if (RATE_LIMIT.test(detail)) {
    const resetAt =
      typeof error.resetsAt === "number" ? error.resetsAt * 1000 : undefined;
    return { type: "limit", kind: "rate_limited", detail, resetAt };
  }
  if (THREAD_FULL.test(detail)) {
    return { type: "limit", kind: "thread_full", detail };
  }
  return { type: "error", message: detail };
}

/**
 * `message_limit` arrives with every reply and carries real quota state, which
 * beats regex-matching error prose. Shape (from the captured fixture):
 *   { type: "message_limit", message_limit: {
 *       type: "within_limit",
 *       windows: { "5h": { status, resets_at, utilization }, "7d": {…} } } }
 */
function extractQuota(payload: unknown): RawChunk | null {
  const root = asRecord(payload);
  if (!root || root.type !== "message_limit") return null;
  const limit = asRecord(root.message_limit);
  if (!limit) return null;

  const status = typeof limit.type === "string" ? limit.type : "unknown";
  if (status !== "within_limit") {
    return {
      type: "limit",
      kind: "rate_limited",
      detail: `usage limit reached (${status})`,
      resetAt:
        typeof limit.resetsAt === "number" ? limit.resetsAt * 1000 : undefined,
    };
  }

  // Report the tightest window — that is the one that will bite first.
  let worst: { window: string; utilization: number; resetsAt?: number } | null =
    null;
  for (const [name, raw] of Object.entries(asRecord(limit.windows) ?? {})) {
    const window = asRecord(raw);
    if (!window) continue;
    const utilization =
      typeof window.utilization === "number" ? window.utilization : 0;
    if (!worst || utilization > worst.utilization) {
      worst = {
        window: name,
        utilization,
        resetsAt:
          typeof window.resets_at === "number"
            ? window.resets_at * 1000
            : undefined,
      };
    }
  }
  return worst ? { type: "quota", ...worst } : null;
}

export const claudeAdapter: SiteAdapter = {
  id: "claude",
  label: "Claude (claude.ai)",
  adapterVersion: "1.0.0",

  newChatUrl: () => "https://claude.ai/new",

  completionUrlPatterns: ["/completion", "/chat_conversations/"],

  composerSelectors: [
    'div[contenteditable="true"].ProseMirror',
    'div[contenteditable="true"]',
    'div[role="textbox"]',
  ],

  submitSelectors: [
    'button[aria-label="Send message"]',
    'button[aria-label*="Send" i]',
    'button[type="submit"]',
  ],

  decodeFrame(frame: SseFrame): RawChunk | null {
    const payload = parseFrameJson(frame);
    if (payload === null) return null;

    const quota = extractQuota(payload);
    if (quota) return quota;

    const limit = extractLimit(payload);
    if (limit) return limit;

    const text = extractText(payload);
    if (text !== null && text.length > 0) return { type: "delta", text };

    return null;
  },
};
