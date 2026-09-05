// =============================================================================
// Headless permission behavior for `freecode run` (--yes / --allow).
//
// With no frontend subscribed to the bus, askPermission rejects, and an
// unanswered ask is a denial by design (permission/prompt.ts). That is correct
// interactively and made `freecode run "fix the test"` in build mode read files
// fine and be denied every write. These pin the two ways out, and pin that
// neither one weakens a deny rule.
// =============================================================================

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { makeTestLayer } from "../effect/layers.js";
import { makeRuntime } from "../effect/runtime.js";
import { SessionStoreTag } from "../effect/context.js";
import { createAgentLoopEffect } from "./loop.js";
import { registerProvider } from "../providers/registry.js";
import type { ProviderId } from "../providers/config.js";
import type { AIProvider, ExecuteResult } from "../providers/types.js";

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

// A provider that asks for one write on the first turn, then stops.
function registerWriter(provider: string, filePath: string) {
  let turn = 0;
  registerProvider(provider as ProviderId, {
    info: info(provider),
    create: (): AIProvider => ({
      info: info(provider),
      execute: async (): Promise<ExecuteResult> => {
        turn += 1;
        if (turn === 1) {
          return {
            content: "writing the file",
            toolCalls: [
              {
                name: "write",
                args: { filePath, content: "written\n" },
                id: "call-write-1",
              },
            ],
            stopReason: "tool_use",
            provider,
            model: "fake-model",
          };
        }
        return {
          content: "done",
          toolCalls: [],
          stopReason: "stop",
          provider,
          model: "fake-model",
        };
      },
    }),
  });
}

async function runOnce(opts: {
  sessionId: string;
  provider: string;
  autoApproveAsks?: boolean;
  sessionGrants?: string[];
  settings?: Record<string, unknown>;
}) {
  const projectPath = mkdtempSync(join(tmpdir(), "freecode-headless-perm-"));
  const target = join(projectPath, "out.txt");
  registerWriter(opts.provider, target);

  if (opts.settings) {
    mkdirSync(join(projectPath, ".freecode"), { recursive: true });
    writeFileSync(
      join(projectPath, ".freecode", "settings.json"),
      JSON.stringify(opts.settings),
    );
  }

  const runtime = makeRuntime(makeTestLayer({}));
  try {
    const store = await runtime.runPromise(SessionStoreTag);
    await store.createSession(
      { title: "t", projectPath, provider: opts.provider },
      opts.sessionId,
    );
    const loop = await runtime.runPromise(
      createAgentLoopEffect(opts.sessionId, {
        maxIterations: 3,
        autoApproveAsks: opts.autoApproveAsks,
        sessionGrants: opts.sessionGrants,
      }),
    );
    await loop.run({
      prompt: "write the file",
      sessionId: opts.sessionId,
      provider: opts.provider,
      projectPath,
      agentMode: "build",
    });
    return { target, wrote: existsSync(target) };
  } finally {
    await runtime.dispose();
  }
}

test("headless build mode denies a write when nothing can answer the ask", async () => {
  const { wrote } = await runOnce({
    sessionId: "headless-deny",
    provider: "headless-perm-deny",
  });
  assert.equal(wrote, false, "unattended ask must not silently allow");
});

test("--yes approves the ask and the write actually lands", async () => {
  const { target, wrote } = await runOnce({
    sessionId: "headless-yes",
    provider: "headless-perm-yes",
    autoApproveAsks: true,
  });
  assert.equal(wrote, true, "--yes should answer the ask with allow");
  assert.equal(readFileSync(target, "utf-8"), "written\n");
});

test("--allow grants a matching rule for the run only", async () => {
  const { wrote } = await runOnce({
    sessionId: "headless-allow",
    provider: "headless-perm-allow",
    sessionGrants: ["Write"],
  });
  assert.equal(wrote, true, "a session grant should satisfy the ask");
});

test("--yes never overrides a deny rule", async () => {
  const { wrote } = await runOnce({
    sessionId: "headless-yes-vs-deny",
    provider: "headless-perm-yes-deny",
    autoApproveAsks: true,
    settings: { permissions: { deny: ["Write"] } },
  });
  assert.equal(wrote, false, "deny is absolute; --yes answers asks, not denials");
});

test("--yes never overrides a read-only mode", async () => {
  const projectPath = mkdtempSync(join(tmpdir(), "freecode-headless-plan-"));
  const target = join(projectPath, "out.txt");
  const provider = "headless-perm-plan";
  registerWriter(provider, target);

  const runtime = makeRuntime(makeTestLayer({}));
  try {
    const store = await runtime.runPromise(SessionStoreTag);
    await store.createSession({ title: "t", projectPath, provider }, "headless-plan");
    const loop = await runtime.runPromise(
      createAgentLoopEffect("headless-plan", {
        maxIterations: 3,
        autoApproveAsks: true,
      }),
    );
    await loop.run({
      prompt: "write the file",
      sessionId: "headless-plan",
      provider,
      projectPath,
      agentMode: "plan",
    });
    assert.equal(existsSync(target), false, "plan mode is read-only regardless of --yes");
  } finally {
    await runtime.dispose();
  }
});
