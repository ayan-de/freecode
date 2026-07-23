import test from "node:test";
import assert from "node:assert/strict";
import type { SerializedMessage } from "./store.js";
import { keepLastNUserTurns } from "./compact-apply.js";

function msg(role: SerializedMessage["role"], text: string): SerializedMessage {
  return {
    id: `${role}-${text}`,
    role,
    parts: [{ type: "text", content: text }],
    timestamp: 0,
  };
}

test("keepLastNUserTurns keeps the last N user turns and everything after", () => {
  const messages = [
    msg("user", "u1"),
    msg("assistant", "a1"),
    msg("user", "u2"),
    msg("assistant", "a2"),
    msg("user", "u3"),
    msg("assistant", "a3"),
  ];

  const kept = keepLastNUserTurns(messages, 2);
  assert.deepEqual(
    kept.map((m) => m.id),
    ["user-u2", "assistant-a2", "user-u3", "assistant-a3"],
  );
  // Still starts on a user turn → valid conversation.
  assert.equal(kept[0].role, "user");
});

test("keepLastNUserTurns keeps everything when fewer than N user turns", () => {
  const messages = [msg("user", "u1"), msg("assistant", "a1")];
  assert.deepEqual(keepLastNUserTurns(messages, 2), messages);
});

test("keepLastNUserTurns with n<=0 keeps nothing", () => {
  assert.deepEqual(keepLastNUserTurns([msg("user", "u1")], 0), []);
});
