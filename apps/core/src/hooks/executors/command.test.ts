// =============================================================================
// Command executor contract tests — env payloads, JSON stdout, exit codes
// =============================================================================

import test from "node:test";
import assert from "node:assert/strict";
import { executeCommandHook } from "./command.js";
import type { HookContext, ToolCallInput } from "../types.js";

const ctx: HookContext = { sessionId: "s1", turnCount: 1 };
const input: ToolCallInput = {
  toolName: "bash",
  toolInput: { command: "ls" },
};

test("a hook reads the tool output from $CLAUDE_TOOL_OUTPUT", async () => {
  const result = await executeCommandHook(
    'echo "saw: $CLAUDE_TOOL_OUTPUT"',
    { ...input, result: "tool says hi" },
    ctx,
  );
  assert.equal(result.success, true);
  assert.equal(result.additionalContext, "saw: tool says hi");
});

test("$CLAUDE_TOOL_OUTPUT is unset when the input carries no result", async () => {
  const result = await executeCommandHook(
    'echo "set: ${CLAUDE_TOOL_OUTPUT-no}"',
    input,
    ctx,
  );
  assert.equal(result.additionalContext, "set: no");
});

test("JSON stdout can set modifiedOutput", async () => {
  const result = await executeCommandHook(
    `echo '{"modifiedOutput": "rewritten"}'`,
    input,
    ctx,
  );
  assert.equal(result.success, true);
  assert.equal(result.modifiedOutput, "rewritten");
});

test("a non-zero exit blocks even when the hook prints non-blocking JSON", async () => {
  const result = await executeCommandHook(
    `echo '{"block": false}'; exit 1`,
    input,
    ctx,
  );
  assert.equal(result.success, false);
  assert.equal(result.blocked, true);
  assert.equal(result.blockReason, "Exit code 1");
});

test("a non-zero exit takes its reason from the JSON when one is given", async () => {
  const result = await executeCommandHook(
    `echo '{"reason": "lint failed"}'; exit 1`,
    input,
    ctx,
  );
  assert.equal(result.blocked, true);
  assert.equal(result.blockReason, "lint failed");
});

test("exit 2 still blocks with stderr as the reason", async () => {
  const result = await executeCommandHook(
    `echo "nope" >&2; exit 2`,
    input,
    ctx,
  );
  assert.equal(result.blocked, true);
  assert.match(String(result.blockReason), /nope/);
});

test("plain stdout on exit 0 is additionalContext", async () => {
  const result = await executeCommandHook("echo plain", input, ctx);
  assert.equal(result.success, true);
  assert.equal(result.additionalContext, "plain");
});
