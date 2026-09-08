// =============================================================================
// board-webhook — reports agent activity to a supervising board (AgentBoard)
// over HTTP, and lets that board answer permission requests remotely.
//
// Entirely inert unless FREECODE_HOOK_URL is set, so a normal interactive run
// pays nothing for it. Payloads deliberately use the Claude Code hook JSON
// shape (hook_event_name / tool_name / tool_use_id / tool_input) so the board
// needs no FreeCode-specific mapper — one receiver serves every agent it
// supervises.
//
// Reporting is fire-and-forget: a board that is slow, down, or wrong must
// never delay or break a turn. The one place we do wait is a permission
// request, where waiting is the entire point.
// =============================================================================

import { registerHook } from "../registry.js";
import type {
  HookContext,
  HookEventName,
  HookResult,
  ToolCallInput,
} from "../types.js";
import {
  bus,
  answerPermission,
  rejectPermission,
  type PermissionAnswer,
  type PermissionAskedEvent,
  type QuestionAskedEvent,
} from "../../bus/index.js";

export interface BoardPayload {
  hook_event_name:
    | "SessionStart"
    | "UserPromptSubmit"
    | "PreToolUse"
    | "PostToolUse"
    | "Stop"
    | "PermissionRequest"
    | "Notification";
  session_id?: string;
  tool_name?: string;
  tool_use_id?: string;
  tool_input?: Record<string, unknown>;
  notification_type?: "agent_needs_input";
}

// The events worth a network call. TurnEnd fires per internal turn and would
// read as "the agent finished" many times inside one request; UserPromptSubmit
// carries the joined system prompt rather than the user's text, so TurnStart
// stands in for it.
const FORWARDED: readonly HookEventName[] = [
  "SessionStart",
  "TurnStart",
  "PreToolUse",
  "PostToolUse",
  "Stop",
];

// Matches FreeCode's own PROMPT_TIMEOUT_MS: the board may hold the answer for
// as long as the agent is willing to wait for a human, and no longer.
const PERMISSION_WAIT_MS = 30 * 60 * 1000;
// Reporting is advisory. If the board cannot answer in two seconds, the turn
// proceeds and the next event repairs the board's picture.
const EVENT_TIMEOUT_MS = 2000;

// =============================================================================
// Pure mappers — the payload contract, testable without a socket
// =============================================================================

export function hookEventToPayload(
  event: HookEventName,
  input: ToolCallInput,
  ctx: HookContext,
): BoardPayload | null {
  const session_id = ctx.sessionId;
  switch (event) {
    case "SessionStart":
      return { hook_event_name: "SessionStart", session_id };
    case "TurnStart":
      return { hook_event_name: "UserPromptSubmit", session_id };
    case "Stop":
      return { hook_event_name: "Stop", session_id };
    case "PreToolUse":
    case "PostToolUse":
      return {
        hook_event_name: event,
        session_id,
        tool_name: input.toolName,
        tool_use_id:
          typeof ctx.toolUseId === "string" ? ctx.toolUseId : undefined,
        tool_input: input.toolInput,
      };
    default:
      return null;
  }
}

export function permissionToPayload(e: PermissionAskedEvent): BoardPayload {
  return {
    hook_event_name: "PermissionRequest",
    session_id: e.sessionId,
    tool_name: e.toolName,
    tool_input: e.args,
  };
}

export function questionToPayload(e: QuestionAskedEvent): BoardPayload {
  return {
    hook_event_name: "Notification",
    session_id: e.sessionId,
    notification_type: "agent_needs_input",
  };
}

/**
 * Read a decision out of the board's reply.
 *
 * Returns null for anything that is not an explicit allow or deny — a
 * timeout, an unreachable board, a malformed body. Null means "the board did
 * not decide", which leaves the pane picker to the human; it must never be
 * confused with a deny.
 */
export function replyToAnswer(
  reply: unknown,
): PermissionAnswer | "reject" | null {
  if (typeof reply !== "object" || reply === null) return null;
  const output = (reply as { hookSpecificOutput?: unknown }).hookSpecificOutput;
  if (typeof output !== "object" || output === null) return null;
  const decision = (output as { decision?: unknown }).decision;
  // allow-once only. A remote click approves this call, not the rest of the
  // run — widening the grant is a decision the human makes at the picker.
  if (decision === "allow") return { decision: "allow-once" };
  if (decision === "deny") return "reject";
  return null;
}

// =============================================================================
// Transport
// =============================================================================

function hookUrl(): string | undefined {
  const url = process.env.FREECODE_HOOK_URL;
  return url && url.length > 0 ? url : undefined;
}

async function post(
  body: BoardPayload,
  timeoutMs: number,
): Promise<unknown | undefined> {
  const url = hookUrl();
  if (!url) return undefined;

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        // Lets the board drop hooks from a previous launch of this session;
        // a relaunched agent's late events would otherwise corrupt its state.
        "x-agentboard-launch": process.env.AGENTBOARD_LAUNCH_ID ?? "",
      },
      body: JSON.stringify(body),
      signal: ac.signal,
    });
    if (!res.ok) return undefined;
    return await res.json().catch(() => undefined);
  } catch {
    // Swallowed on purpose: an observer must not be able to fail a turn.
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

// =============================================================================
// Registration
// =============================================================================

export function registerBoardWebhook(): void {
  if (!hookUrl()) return;

  for (const event of FORWARDED) {
    registerHook(
      event,
      `board-webhook-${event}`,
      {
        type: "callback",
        internal: true,
        callback: async (
          input: ToolCallInput,
          ctx: HookContext,
        ): Promise<HookResult> => {
          const payload = hookEventToPayload(event, input, ctx);
          // Not awaited: the turn continues while the report is in flight.
          if (payload) void post(payload, EVENT_TIMEOUT_MS);
          return { action: "continue" };
        },
      },
      // "session", not "settings": HookSettingsManager.load() clears every
      // settings-source hook on each (re)load, which would silently unregister
      // this one the moment settings.json is read or changed.
      "session",
    );
  }

  // Subscribing at all is what makes headless approval possible: askPermission
  // rejects immediately when nothing is listening for permission.asked.
  // The board and the pane picker race; whoever answers first wins, and
  // answerPermission simply returns false for the loser.
  bus.subscribe("permission.asked", (e) => {
    void (async () => {
      const answer = replyToAnswer(
        await post(permissionToPayload(e), PERMISSION_WAIT_MS),
      );
      if (answer === null) return; // board abstained — leave it to the human
      if (answer === "reject") rejectPermission(e.requestId);
      else answerPermission(e.requestId, answer);
    })();
  });

  // Questions are answered in the pane, not remotely — the board only needs to
  // know the agent is waiting so it can raise a notification.
  bus.subscribe("question.asked", (e) => {
    void post(questionToPayload(e), EVENT_TIMEOUT_MS);
  });
}
