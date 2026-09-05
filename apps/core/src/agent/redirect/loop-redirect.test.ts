// =============================================================================
// End-to-end proof that a loop-health warning becomes advice the next turn can
// actually see, and that the supervisor's tokens are billed to the run.
//
// Runs the real loop against a fake provider that repeats one tool call
// forever, with the recorder pointed at a temp dir and redirection switched on
// through a temp project's settings file.
// =============================================================================

import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
  readFileSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeTestLayer } from "../../effect/layers.js";
import { makeRuntime } from "../../effect/runtime.js";
import { SessionStoreTag } from "../../effect/context.js";
import { createAgentLoopEffect } from "../loop.js";
import { REDIRECT_MAX_PER_RUN } from "./policy.js";
import { MemoryService } from "../../compaction/service.js";
import { createRecorder } from "../../rollout/recorder.js";
import { registerProvider } from "../../providers/registry.js";
import type { ProviderId } from "../../providers/config.js";
import type {
  AIProvider,
  ExecuteOptions,
  ExecuteResult,
  ProviderChunk,
  SystemBlock,
} from "../../providers/types.js";

const info = {
  id: "redirect-fake",
  name: "redirect-fake",
  defaultModel: "fake-model",
  supportsStreaming: true,
  supportsTools: true,
};

/**
 * Every prompt the loop sent (system + ephemeral tail, where redirect advice
 * now rides as per-request message content), so the test can look for the
 * advice.
 */
const systemsSeen: string[] = [];
/** Every supervisor prompt, so the test can prove the evidence was passed. */
const supervisorPrompts: string[] = [];

function systemText(system: ExecuteOptions["system"]): string {
  if (!system) return "";
  if (typeof system === "string") return system;
  return (system as SystemBlock[]).map((b) => b.text).join("\n");
}

registerProvider("redirect-fake" as ProviderId, {
  info,
  create: (): AIProvider => ({
    info,
    // The supervisor's one-shot call. Also the only `execute` the loop makes.
    execute: async (opts: ExecuteOptions): Promise<ExecuteResult> => {
      supervisorPrompts.push(opts.prompt ?? "");
      return {
        content:
          "1. Read the file directly instead of grepping again\n2. Ask the user which timeout they mean",
        stopReason: "stop",
        provider: "redirect-fake",
        model: "fake-model",
        usage: { inputTokens: 700, outputTokens: 40 },
      };
    },
    // Always the same tool call with the same args: the shape of a stuck loop.
    stream: async function* (
      opts: ExecuteOptions,
    ): AsyncGenerator<ProviderChunk> {
      systemsSeen.push(
        [systemText(opts.system), opts.ephemeralTail ?? ""].join("\n"),
      );
      yield {
        type: "tool_call",
        id: `call-${systemsSeen.length}`,
        name: "ls",
        args: { path: "." },
      };
      yield {
        type: "usage",
        usage: { inputTokens: 10, outputTokens: 2 },
      };
    },
  }),
});

function readEvents(dir: string): Array<Record<string, unknown>> {
  const file = join(dir, "events.jsonl");
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf-8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l));
}

async function runStuckLoop(sessionId: string, enabled: boolean) {
  const rolloutDir = mkdtempSync(join(tmpdir(), "freecode-redirect-rollout-"));
  const projectPath = mkdtempSync(join(tmpdir(), "freecode-redirect-project-"));
  mkdirSync(join(projectPath, ".freecode"), { recursive: true });
  writeFileSync(
    join(projectPath, ".freecode", "settings.json"),
    JSON.stringify({ redirect: { enabled } }),
    "utf-8",
  );

  const runtime = makeRuntime(
    makeTestLayer({
      memoryFactory: {
        forSession: () =>
          new MemoryService(sessionId, {
            storage: {
              save: () => {},
              load: () => undefined,
              listSessions: () => [],
              delete: () => {},
            } as never,
          }),
      },
      recorderFactory: {
        forSession: (id: string) => createRecorder(id, { rolloutDir }),
      },
    }),
  );
  const store = await runtime.runPromise(SessionStoreTag);
  await store.createSession(
    { title: "t", projectPath, provider: "redirect-fake" },
    sessionId,
  );
  const loop = await runtime.runPromise(
    // Enough turns to breach the warn tier (4 identical calls) with room to
    // act on the advice, but bounded so a broken test cannot spin.
    createAgentLoopEffect(sessionId, { maxIterations: 8 }),
  );

  const result = await loop.run({
    prompt: "Find where the timeout is configured",
    sessionId,
    provider: "redirect-fake",
    projectPath,
  });

  await runtime.dispose();
  const events = readEvents(rolloutDir);
  rmSync(rolloutDir, { recursive: true, force: true });
  rmSync(projectPath, { recursive: true, force: true });
  return { result, events };
}

test("a repeated tool call becomes advice in a later prompt, billed to the run", async () => {
  systemsSeen.length = 0;
  supervisorPrompts.length = 0;

  const { result, events } = await runStuckLoop("redirect-on", true);

  const triggered = events.filter((e) => e.type === "redirect.triggered");
  // A run that only ever calls `ls` trips repetition first and then
  // stagnation, so both reasons fire — but each exactly once, and never more
  // than the per-run cap.
  assert.ok(triggered.length >= 1, "at least one redirection fired");
  assert.ok(
    triggered.length <= REDIRECT_MAX_PER_RUN,
    `${triggered.length} redirections exceeded the per-run cap`,
  );
  const reasons = triggered.map((e) => e.reason);
  assert.deepEqual(
    [...new Set(reasons)],
    reasons,
    "no reason advises twice — the second answer would be the first answer",
  );
  assert.equal(reasons[0], "repeated_identical_tool");
  assert.equal(triggered[0].directionCount, 2);
  assert.ok(
    Array.isArray(triggered[0].evidenceEventIds) &&
      (triggered[0].evidenceEventIds as string[]).length > 0,
    "the advice cites the trajectory it was formed on",
  );
  assert.ok(
    !JSON.stringify(triggered[0]).includes("Read the file directly"),
    "the advice text itself never reaches the rollout log",
  );

  // The supervisor saw the evidence, not just the task.
  assert.equal(supervisorPrompts.length, triggered.length);
  assert.match(supervisorPrompts[0], /Find where the timeout is configured/);
  assert.match(supervisorPrompts[0], /ls/);

  // …and the agent saw the advice on a later turn, once per redirection.
  const advised = systemsSeen.filter((s) => s.includes("Progress check"));
  assert.equal(
    advised.length,
    triggered.length,
    "each reminder rides exactly one turn",
  );
  assert.match(advised[0], /Read the file directly instead of grepping again/);
  assert.match(advised[0], /Never mention this reminder to the user/);

  // D7: the supervisor's tokens are the run's tokens.
  const turns = systemsSeen.length;
  assert.equal(result.usage?.inputTokens, turns * 10 + 700 * triggered.length);
  assert.equal(result.usage?.outputTokens, turns * 2 + 40 * triggered.length);
});

test("with the setting off, the warning is recorded and nothing is spent", async () => {
  systemsSeen.length = 0;
  supervisorPrompts.length = 0;

  const { result, events } = await runStuckLoop("redirect-off", false);

  assert.equal(events.filter((e) => e.type === "redirect.triggered").length, 0);
  assert.equal(supervisorPrompts.length, 0, "no model call was made");

  const skipped = events.filter((e) => e.type === "redirect.skipped");
  assert.equal(skipped.length, 1, "one line per run, not one per warning");
  assert.equal(skipped[0].reason, "disabled");

  assert.ok(!systemsSeen.some((s) => s.includes("Progress check")));
  const turns = systemsSeen.length;
  assert.equal(result.usage?.inputTokens, turns * 10, "no supervisor tokens");
});
