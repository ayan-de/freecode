// =============================================================================
// PostToolUse / UserPromptSubmit payload tests — hooks see what they rewrite
// =============================================================================

import test from "node:test";
import assert from "node:assert/strict";
import { registerHook, unregisterAllHooks } from "./registry.js";
import { runPostToolUseHooks } from "./PostToolUse.js";
import { runUserPromptSubmitHooks } from "./UserPromptSubmit.js";
import { MAX_HOOK_PAYLOAD_CHARS } from "./types.js";
import type { ToolCall, ToolResult } from "../agent/types.js";

const ctx = { sessionId: "s1", turnCount: 1 };

const toolCall: ToolCall = {
  id: "c1",
  tool: "bash",
  args: { command: "ls" },
  execution: "sequential",
};

function toolResult(stdout: string): ToolResult {
  return { id: "r1", toolCallId: "c1", tool: "bash", title: "bash", stdout };
}

test("PostToolUse hooks receive the tool's output", async () => {
  unregisterAllHooks();
  let seen: string | undefined;
  registerHook("PostToolUse", "spy", {
    type: "callback",
    callback: async (input) => {
      seen = input.result;
      return { action: "continue" };
    },
  });
  await runPostToolUseHooks(toolCall, toolResult("the output"), ctx);
  assert.equal(seen, "the output");
  unregisterAllHooks();
});

test("PostToolUse output is capped for the env-var boundary", async () => {
  unregisterAllHooks();
  let seen = "";
  registerHook("PostToolUse", "spy", {
    type: "callback",
    callback: async (input) => {
      seen = input.result ?? "";
      return { action: "continue" };
    },
  });
  await runPostToolUseHooks(
    toolCall,
    toolResult("x".repeat(MAX_HOOK_PAYLOAD_CHARS + 100)),
    ctx,
  );
  assert.ok(seen.length <= MAX_HOOK_PAYLOAD_CHARS + 32);
  assert.match(seen, /\[output truncated\]$/);
  unregisterAllHooks();
});

test("UserPromptSubmit hooks receive the prompt itself", async () => {
  unregisterAllHooks();
  let seen: Record<string, unknown> = {};
  registerHook("UserPromptSubmit", "spy", {
    type: "callback",
    callback: async (input) => {
      seen = input.toolInput;
      return { action: "continue" };
    },
  });
  await runUserPromptSubmitHooks("fix the bug", ctx);
  assert.equal(seen.prompt, "fix the bug");
  assert.equal(seen.promptLength, 11);
  unregisterAllHooks();
});

test("UserPromptSubmit keeps the real length when the prompt is truncated", async () => {
  unregisterAllHooks();
  let seen: Record<string, unknown> = {};
  registerHook("UserPromptSubmit", "spy", {
    type: "callback",
    callback: async (input) => {
      seen = input.toolInput;
      return { action: "continue" };
    },
  });
  const long = "y".repeat(MAX_HOOK_PAYLOAD_CHARS + 500);
  await runUserPromptSubmitHooks(long, ctx);
  assert.equal(seen.promptLength, long.length);
  assert.match(String(seen.prompt), /\[prompt truncated\]$/);
  unregisterAllHooks();
});

test("a UserPromptSubmit hook's modifiedOutput becomes modifiedPrompt", async () => {
  unregisterAllHooks();
  registerHook("UserPromptSubmit", "rewrite", {
    type: "callback",
    callback: async () => ({
      action: "modify",
      modifiedOutput: "rewritten prompt",
    }),
  });
  const result = await runUserPromptSubmitHooks("original", ctx);
  assert.equal(result.modifiedPrompt, "rewritten prompt");
  unregisterAllHooks();
});
