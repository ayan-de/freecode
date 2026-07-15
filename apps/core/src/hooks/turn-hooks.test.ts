// =============================================================================
// TurnStart / TurnEnd / Notification hook routing tests
// =============================================================================

import test from "node:test";
import assert from "node:assert/strict";
import { registerHook, unregisterAllHooks } from "./registry.js";
import { runTurnStartHooks } from "./TurnStart.js";
import { runTurnEndHooks } from "./TurnEnd.js";
import { runNotificationHooks } from "./Notification.js";

const ctx = { sessionId: "s1", turnCount: 3 };

test("TurnStart hooks fire and return context", async () => {
  unregisterAllHooks();
  registerHook("TurnStart", "test-turn-start", {
    type: "callback",
    callback: async (input) => {
      assert.equal(input.toolInput.turnCount, 3);
      return { action: "continue" };
    },
  });
  const result = await runTurnStartHooks(ctx);
  assert.deepEqual(result, { additionalContext: undefined });
  unregisterAllHooks();
});

test("TurnEnd hooks receive usage in toolInput", async () => {
  unregisterAllHooks();
  let seen: Record<string, unknown> = {};
  registerHook("TurnEnd", "test-turn-end", {
    type: "callback",
    callback: async (input) => {
      seen = input.toolInput;
      return { action: "continue" };
    },
  });
  await runTurnEndHooks(ctx, { inputTokens: 100, outputTokens: 50 });
  assert.equal(seen.turnCount, 3);
  assert.equal(seen.inputTokens, 100);
  assert.equal(seen.outputTokens, 50);
  unregisterAllHooks();
});

test("Notification hooks receive the message", async () => {
  unregisterAllHooks();
  let message = "";
  registerHook("Notification", "test-notification", {
    type: "callback",
    callback: async (input) => {
      message = String(input.toolInput.message);
      return { action: "continue" };
    },
  });
  await runNotificationHooks("Permission needed: bash", ctx);
  assert.equal(message, "Permission needed: bash");
  unregisterAllHooks();
});
