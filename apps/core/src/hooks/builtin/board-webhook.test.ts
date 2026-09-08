// =============================================================================
// board-webhook tests — pure mappers only (no network, no bus).
// The payload shape is a contract with an external supervisor, so every field
// is asserted structurally rather than spot-checked.
// =============================================================================

import test from "node:test";
import assert from "node:assert/strict";
import {
  hookEventToPayload,
  permissionToPayload,
  questionToPayload,
  replyToAnswer,
} from "./board-webhook.js";

const ctx = {
  sessionId: "s1",
  turnCount: 2,
  toolName: "bash",
  toolUseId: "call_1",
};
const input = { toolName: "bash", toolInput: { command: "ls" } };

// --- hook events -------------------------------------------------------------

test("TurnStart is reported to the board as UserPromptSubmit", () => {
  // FreeCode's own UserPromptSubmit carries the joined *system* prompt, so
  // TurnStart is the honest "a turn began" signal.
  assert.deepEqual(hookEventToPayload("TurnStart", input, ctx), {
    hook_event_name: "UserPromptSubmit",
    session_id: "s1",
  });
});

test("PreToolUse and PostToolUse carry tool name, id and input", () => {
  for (const ev of ["PreToolUse", "PostToolUse"] as const) {
    assert.deepEqual(hookEventToPayload(ev, input, ctx), {
      hook_event_name: ev,
      session_id: "s1",
      tool_name: "bash",
      tool_use_id: "call_1",
      tool_input: { command: "ls" },
    });
  }
});

test("tool events omit the id when the context has none", () => {
  const payload = hookEventToPayload("PreToolUse", input, {
    sessionId: "s1",
    turnCount: 1,
  });
  assert.equal(payload?.tool_use_id, undefined);
  assert.equal(payload?.tool_name, "bash");
});

test("SessionStart and Stop map directly", () => {
  assert.deepEqual(hookEventToPayload("SessionStart", input, ctx), {
    hook_event_name: "SessionStart",
    session_id: "s1",
  });
  assert.deepEqual(hookEventToPayload("Stop", input, ctx), {
    hook_event_name: "Stop",
    session_id: "s1",
  });
});

test("events the board does not model are dropped", () => {
  // TurnEnd fires per internal turn and would read as "finished" far too
  // often; UserPromptSubmit is the system prompt, already covered by TurnStart.
  for (const ev of [
    "TurnEnd",
    "UserPromptSubmit",
    "PreCompact",
    "PostCompact",
    "SubagentStart",
    "SubagentStop",
    "PostToolUseFailure",
    "PermissionRequest",
    "Notification",
  ] as const) {
    assert.equal(hookEventToPayload(ev, input, ctx), null, ev);
  }
});

// --- bus events --------------------------------------------------------------

test("permission.asked becomes PermissionRequest", () => {
  assert.deepEqual(
    permissionToPayload({
      type: "permission.asked",
      requestId: "r1",
      sessionId: "s1",
      toolName: "bash",
      args: { command: "rm -rf build" },
      description: "Run rm -rf build",
    }),
    {
      hook_event_name: "PermissionRequest",
      session_id: "s1",
      tool_name: "bash",
      tool_input: { command: "rm -rf build" },
    },
  );
});

test("question.asked becomes Notification agent_needs_input", () => {
  assert.deepEqual(
    questionToPayload({
      type: "question.asked",
      requestId: "q1",
      sessionId: "s1",
      questions: [],
    }),
    {
      hook_event_name: "Notification",
      session_id: "s1",
      notification_type: "agent_needs_input",
    },
  );
});

// --- decisions ---------------------------------------------------------------

test("replyToAnswer maps allow to a one-shot grant", () => {
  // Never allow-session or wider: a remote click must not silently broaden
  // what the agent may do for the rest of the run.
  assert.deepEqual(replyToAnswer({ hookSpecificOutput: { decision: "allow" } }), {
    decision: "allow-once",
  });
});

test("replyToAnswer maps deny to a reject", () => {
  assert.equal(
    replyToAnswer({ hookSpecificOutput: { decision: "deny" } }),
    "reject",
  );
});

test("replyToAnswer treats silence as no decision", () => {
  // A timeout, an unreachable board, or a body without a decision must leave
  // the pane picker to the human rather than resolving the promise.
  for (const reply of [
    undefined,
    null,
    {},
    { hookSpecificOutput: {} },
    { hookSpecificOutput: { decision: "maybe" } },
    { decision: "allow" },
    "allow",
  ]) {
    assert.equal(replyToAnswer(reply), null, JSON.stringify(reply));
  }
});
