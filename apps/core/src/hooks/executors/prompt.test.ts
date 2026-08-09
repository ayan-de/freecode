import test from "node:test";
import assert from "node:assert/strict";
import { executePromptHook } from "./prompt.js";
import { registerProvider } from "../../providers/registry.js";
import type { PromptHook, HookContext, ToolCallInput } from "../types.js";
import type { AIProvider, ExecuteResult } from "../../providers/types.js";
import type { ProviderId } from "../../providers/config.js";

let nextContent = "";
let lastPrompt: string | undefined;

registerProvider("test-prompt-hook" as ProviderId, {
  info: {
    id: "test-prompt-hook",
    name: "test-prompt-hook",
    defaultModel: "fake-model",
    supportsStreaming: false,
    supportsTools: false,
  },
  create: (): AIProvider => ({
    info: {
      id: "test-prompt-hook",
      name: "test-prompt-hook",
      defaultModel: "fake-model",
      supportsStreaming: false,
      supportsTools: false,
    },
    execute: async (opts): Promise<ExecuteResult> => {
      lastPrompt = opts.prompt;
      return {
        content: nextContent,
        stopReason: "stop",
        provider: "test-prompt-hook",
        model: "fake-model",
      };
    },
  }),
});

const input: ToolCallInput = {
  toolName: "Bash",
  toolInput: { command: "rm -rf /" },
};

const context: HookContext = {
  sessionId: "s1",
  turnCount: 1,
  provider: "test-prompt-hook",
};

test("prompt hook: allow decision returns success", async () => {
  nextContent = '{"decision":"allow","reason":"looks fine"}';
  const hook: PromptHook = { type: "prompt", prompt: "Should I allow this?" };
  const result = await executePromptHook(hook, input, context);
  assert.equal(result.success, true);
  assert.equal(result.additionalContext, "looks fine");
});

test("prompt hook: block decision blocks with reason", async () => {
  nextContent = '{"decision":"block","reason":"destructive command"}';
  const hook: PromptHook = { type: "prompt", prompt: "Should I allow this?" };
  const result = await executePromptHook(hook, input, context);
  assert.equal(result.success, false);
  assert.equal(result.blocked, true);
  assert.equal(result.blockReason, "destructive command");
});

test("prompt hook: non-JSON response fails open with raw text as context", async () => {
  nextContent = "Sure, go ahead.";
  const hook: PromptHook = { type: "prompt", prompt: "Should I allow this?" };
  const result = await executePromptHook(hook, input, context);
  assert.equal(result.success, true);
  assert.equal(result.additionalContext, "Sure, go ahead.");
});

test("prompt hook: includes tool name and input in the rendered prompt", async () => {
  nextContent = '{"decision":"allow"}';
  const hook: PromptHook = { type: "prompt", prompt: "Evaluate this tool call." };
  await executePromptHook(hook, input, context);
  assert.match(lastPrompt ?? "", /Evaluate this tool call\./);
  assert.match(lastPrompt ?? "", /Bash/);
  assert.match(lastPrompt ?? "", /rm -rf \//);
});

test("prompt hook: unknown provider returns a non-blocking error", async () => {
  const hook: PromptHook = { type: "prompt", prompt: "Should I allow this?" };
  const badContext: HookContext = { sessionId: "s1", turnCount: 1, provider: "nonexistent-provider" };
  const result = await executePromptHook(hook, input, badContext);
  assert.equal(result.success, false);
  assert.equal(result.blocked, false);
  assert.ok(result.error);
});
