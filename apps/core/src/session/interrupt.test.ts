import test from "node:test";
import assert from "node:assert/strict";
import { InterruptHandler } from "./interrupt.js";

test("InterruptHandler tracks active session/message", () => {
  const handler = new InterruptHandler();
  assert.strictEqual(handler.getState().pending, false);

  handler.setActive("session-1", "msg-1");
  assert.strictEqual(handler.getState().pending, true);
  assert.strictEqual(handler.getState().sessionId, "session-1");
  assert.strictEqual(handler.getState().messageId, "msg-1");

  handler.clear();
  assert.strictEqual(handler.getState().pending, false);
});
