import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeTestLayer } from "../effect/layers.js";
import { makeRuntime } from "../effect/runtime.js";
import { SessionStoreTag } from "../effect/context.js";
import { createAgentLoopEffect } from "./loop.js";
import { MemoryService } from "../compaction/service.js";
import { createRecorder } from "../rollout/recorder.js";
import { registerProvider } from "../providers/registry.js";
import type { ProviderId } from "../providers/config.js";
import type {
  AIProvider,
  ExecuteResult,
  ProviderChunk,
} from "../providers/types.js";
import {
  MAX_TRUNCATED_TOOL_RETRIES,
  truncatedToolCallReminder,
} from "./reminders.js";

test("truncatedToolCallReminder names the tool and says the call never ran", () => {
  const r = truncatedToolCallReminder(["memory"]);
  assert.match(r, /<system-reminder>/);
  assert.match(r, /`memory`/);
  assert.match(r, /never/);
  assert.match(r, /Reissue it with a smaller payload/);
});

test("truncatedToolCallReminder lists every truncated call", () => {
  const r = truncatedToolCallReminder(["write", "memory"]);
  assert.match(r, /`write`/);
  assert.match(r, /`memory`/);
});

// The retry is bounded: each extra turn re-sends the whole prompt, so a model
// that keeps overflowing the output limit must end the run, not spin on it.
test("the truncation retry budget is small and finite", () => {
  assert.ok(
    MAX_TRUNCATED_TOOL_RETRIES > 0 && MAX_TRUNCATED_TOOL_RETRIES <= 3,
    `unexpected retry budget: ${MAX_TRUNCATED_TOOL_RETRIES}`,
  );
});

// =============================================================================
// End-to-end: the loop must give the model another turn after it truncates a
// tool call, and must stop after the retry budget rather than spin. Same fake
// provider harness as loop-tracing.test.ts.
// =============================================================================

function info(id: string) {
  return {
    id,
    name: id,
    defaultModel: "fake-model",
    supportsStreaming: true,
    supportsTools: false,
  };
}

const done: ExecuteResult = {
  content: "done",
  stopReason: "stop",
  provider: "truncate-fake",
  model: "fake-model",
};

// Truncates its first tool call, then answers normally — the model taking the
// reminder's advice.
let onceCalls = 0;
registerProvider("truncate-once-fake" as ProviderId, {
  info: info("truncate-once-fake"),
  create: (): AIProvider => ({
    info: info("truncate-once-fake"),
    execute: async () => done,
    stream: async function* (): AsyncGenerator<ProviderChunk> {
      onceCalls += 1;
      if (onceCalls === 1) {
        yield { type: "text_delta", delta: "saving that" };
        yield { type: "tool_call_invalid", id: "call-1", name: "memory" };
        yield { type: "done", stopReason: "max_tokens" };
        return;
      }
      yield { type: "text_delta", delta: "saved, smaller this time" };
      yield { type: "done", stopReason: "stop" };
    },
  }),
});

// Never stops truncating — the retry budget is the only thing that ends it.
let alwaysCalls = 0;
registerProvider("truncate-always-fake" as ProviderId, {
  info: info("truncate-always-fake"),
  create: (): AIProvider => ({
    info: info("truncate-always-fake"),
    execute: async () => done,
    stream: async function* (): AsyncGenerator<ProviderChunk> {
      alwaysCalls += 1;
      yield { type: "tool_call_invalid", id: "call-1", name: "write" };
      yield { type: "done", stopReason: "max_tokens" };
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

async function runLoop(
  sessionId: string,
  provider: string,
  rolloutDir: string,
) {
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
  const projectPath = mkdtempSync(join(tmpdir(), "freecode-truncate-test-"));
  const store = await runtime.runPromise(SessionStoreTag);
  await store.createSession({ title: "t", projectPath, provider }, sessionId);
  const loop = await runtime.runPromise(
    createAgentLoopEffect(sessionId, { maxIterations: 10 }),
  );
  return { runtime, loop, projectPath };
}

test("a truncated tool call earns another turn instead of ending the run", async () => {
  const rolloutDir = mkdtempSync(join(tmpdir(), "freecode-rollout-"));
  const { runtime, loop, projectPath } = await runLoop(
    "truncate-once",
    "truncate-once-fake",
    rolloutDir,
  );
  try {
    const result = await loop.run({
      prompt: "remember this",
      sessionId: "truncate-once",
      provider: "truncate-once-fake",
      projectPath,
    });

    assert.equal(onceCalls, 2, "the model was given a second turn");
    assert.match(
      String(result.content ?? ""),
      /smaller this time/,
      "the retried turn's answer is what the user gets",
    );
    const requests = readEvents(rolloutDir).filter(
      (e) => e.type === "model.request",
    );
    assert.equal(requests.length, 2);
  } finally {
    await runtime.dispose();
    rmSync(rolloutDir, { recursive: true, force: true });
  }
});

test("a model that keeps truncating stops at the retry budget", async () => {
  const rolloutDir = mkdtempSync(join(tmpdir(), "freecode-rollout-"));
  const { runtime, loop, projectPath } = await runLoop(
    "truncate-always",
    "truncate-always-fake",
    rolloutDir,
  );
  try {
    const result = await loop.run({
      prompt: "write a huge file",
      sessionId: "truncate-always",
      provider: "truncate-always-fake",
      projectPath,
    });

    // One first attempt plus the budget — never the 10-iteration safety valve.
    assert.equal(alwaysCalls, MAX_TRUNCATED_TOOL_RETRIES + 1);
    assert.match(
      String(result.message ?? ""),
      /output tokens/,
      "the run says what stopped it",
    );
  } finally {
    await runtime.dispose();
    rmSync(rolloutDir, { recursive: true, force: true });
  }
});
