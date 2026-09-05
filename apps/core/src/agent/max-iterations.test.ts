// =============================================================================
// Iteration safety-valve behavior (see reminders.ts wrapUpReminder):
// 1. One turn before the cap, the model is nudged to wrap up instead of being
//    cut off silently.
// 2. When the cap trips anyway, the run hands back the model's last text plus
//    a clear note — never a bare "Max iterations reached" with no content.
// =============================================================================

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { makeTestLayer } from "../effect/layers.js";
import { makeRuntime } from "../effect/runtime.js";
import { SessionStoreTag } from "../effect/context.js";
import { createAgentLoopEffect } from "./loop.js";
import { registerProvider } from "../providers/registry.js";
import type { ProviderId } from "../providers/config.js";
import type { AIProvider, ExecuteResult, SystemBlock } from "../providers/types.js";
import { wrapUpReminder } from "./reminders.js";

function info(id: string) {
  return {
    id,
    name: id,
    defaultModel: "fake-model",
    supportsStreaming: false,
    supportsTools: true,
    maxOutputTokens: 4096,
  };
}

test("wrapUpReminder is a system-reminder telling the model to stop and summarize", () => {
  assert.match(wrapUpReminder(), /<system-reminder>/);
  assert.match(wrapUpReminder(), /Do not call any more tools/);
});

test("a run that never stops calling tools gets a graceful wrap-up, not a bare cutoff", async () => {
  const sessionId = "maxiter-session";
  const provider = "maxiter-fake";
  const FINAL_TEXT = "Finished the parser; wiring is still outstanding.";

  const calls: Array<{ system: SystemBlock[]; ephemeralTail?: string }> = [];
  registerProvider(provider as ProviderId, {
    info: info(provider),
    create: (): AIProvider => ({
      info: info(provider),
      execute: async ({ system, ephemeralTail }): Promise<ExecuteResult> => {
        calls.push({
          system: Array.isArray(system) ? system : [],
          ephemeralTail,
        });
        // Always emits a (bogus) tool call, so the loop never stops itself —
        // the only thing that can end this run is the iteration cap.
        return {
          content: calls.length === 3 ? FINAL_TEXT : `working, step ${calls.length}`,
          toolCalls: [{ name: "does-not-exist", args: {}, id: `c${calls.length}` }],
          stopReason: "tool_use",
          provider,
          model: "fake-model",
        };
      },
    }),
  });

  const runtime = makeRuntime(makeTestLayer({}));
  try {
    const projectPath = mkdtempSync(join(tmpdir(), "freecode-maxiter-test-"));
    const store = await runtime.runPromise(SessionStoreTag);
    await store.createSession({ title: "t", projectPath, provider }, sessionId);
    const loop = await runtime.runPromise(
      createAgentLoopEffect(sessionId, {
        maxIterations: 3,
      }),
    );

    const result = await loop.run({
      prompt: "do a long task",
      sessionId,
      provider,
      projectPath,
    });

    assert.equal(result.success, true);
    assert.equal(result.message, "Max iterations reached");
    // Stops exactly at the cap — no runaway extra calls.
    assert.equal(calls.length, 3);
    // The model's last real text survives, not a bare status string.
    assert.match(result.content ?? "", new RegExp(FINAL_TEXT.replace(/[.]/g, "\\.")));
    assert.match(result.content ?? "", /iteration safety limit/);
    // The final turn's prompt carried the wrap-up nudge — in the ephemeral
    // tail, not the system param: reminders are per-request message content
    // so their churn cannot invalidate the cached prefix.
    assert.match(calls[2].ephemeralTail ?? "", /Do not call any more tools/);
    const lastSystem = calls[2].system.map((b) => b.text).join("\n");
    assert.doesNotMatch(lastSystem, /Do not call any more tools/);
    // Earlier turns were not nudged yet.
    assert.doesNotMatch(calls[0].ephemeralTail ?? "", /Do not call any more tools/);
  } finally {
    await runtime.dispose();
  }
});
