// =============================================================================
// End-to-end proof that the agent loop traces its own provider calls, and that
// a provider timeout is classified as a stall rather than a generic failure.
//
// Runs the real loop against fake providers registered in the registry, with
// the recorder pointed at a temp dir, and reads the JSONL back.
// =============================================================================

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
import { StreamStallError } from "../providers/fetch-timeout.js";
import type { ProviderId } from "../providers/config.js";
import type {
  AIProvider,
  ExecuteResult,
  ProviderChunk,
} from "../providers/types.js";

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
  provider: "trace-fake",
  model: "fake-model",
};

// Streams a short healthy response, then finishes.
registerProvider("trace-fake" as ProviderId, {
  info: info("trace-fake"),
  create: (): AIProvider => ({
    info: info("trace-fake"),
    execute: async () => done,
    stream: async function* (): AsyncGenerator<ProviderChunk> {
      yield { type: "text_delta", delta: "All " };
      yield { type: "text_delta", delta: "done." };
      yield {
        type: "usage",
        usage: {
          inputTokens: 1234,
          outputTokens: 7,
          cacheReadInputTokens: 1000,
          cacheWriteInputTokens: 0,
        },
      };
    },
  }),
});

// Fails the way the fetch layer does when a provider goes silent. The timeout
// itself is tested in providers/fetch-timeout.test.ts; what matters here is
// that the loop classifies it as a stall rather than a generic provider error.
registerProvider("stall-fake" as ProviderId, {
  info: info("stall-fake"),
  create: (): AIProvider => ({
    info: info("stall-fake"),
    execute: async () => done,
    // eslint-disable-next-line require-yield
    stream: async function* (): AsyncGenerator<ProviderChunk> {
      throw new StreamStallError(180_000);
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
  const projectPath = mkdtempSync(join(tmpdir(), "freecode-trace-test-"));
  const store = await runtime.runPromise(SessionStoreTag);
  await store.createSession({ title: "t", projectPath, provider }, sessionId);
  const loop = await runtime.runPromise(
    createAgentLoopEffect(sessionId, { maxIterations: 1 }),
  );
  return { runtime, loop, projectPath };
}

test("a healthy turn records request, first token and response", async () => {
  const rolloutDir = mkdtempSync(join(tmpdir(), "freecode-rollout-"));
  const { runtime, loop, projectPath } = await runLoop(
    "trace-ok",
    "trace-fake",
    rolloutDir,
  );
  try {
    await loop.run({
      prompt: "hello",
      sessionId: "trace-ok",
      provider: "trace-fake",
      projectPath,
    });

    const events = readEvents(rolloutDir);
    const request = events.find((e) => e.type === "model.request");
    const firstToken = events.find((e) => e.type === "model.first_token");
    const response = events.find((e) => e.type === "model.response");

    assert.ok(request, "model.request was written");
    assert.equal(request!.provider, "trace-fake");
    assert.equal(request!.streamed, true);
    // The prompt size is the number that makes context growth visible.
    assert.ok((request!.promptChars as number) > 0);

    assert.ok(firstToken, "model.first_token was written");
    assert.ok(typeof firstToken!.ttft_ms === "number");

    assert.ok(response, "model.response was written");
    assert.equal(response!.inputTokens, 1234);
    assert.equal(response!.outputTokens, 7);
    assert.equal(response!.cacheReadTokens, 1000);
    assert.ok(typeof response!.duration_ms === "number");
  } finally {
    await runtime.dispose();
    rmSync(rolloutDir, { recursive: true, force: true });
  }
});

test("a provider timeout is recorded as a stall, not a generic error", async () => {
  const rolloutDir = mkdtempSync(join(tmpdir(), "freecode-rollout-"));
  const { runtime, loop, projectPath } = await runLoop(
    "trace-stall",
    "stall-fake",
    rolloutDir,
  );
  try {
    const startedAt = Date.now();
    await loop.run({
      prompt: "hello",
      sessionId: "trace-stall",
      provider: "stall-fake",
      projectPath,
    });
    const elapsed = Date.now() - startedAt;

    assert.ok(elapsed < 20_000, `loop returned in ${elapsed}ms`);

    const events = readEvents(rolloutDir);
    assert.ok(events.some((e) => e.type === "model.request"));
    assert.ok(
      !events.some((e) => e.type === "model.first_token"),
      "nothing was ever received, so there is no first token",
    );
    const error = events.find((e) => e.type === "model.error");
    assert.ok(error, "the stall was recorded");
    assert.equal(error!.kind, "stall");
    assert.match(String(error!.error), /no data/);
  } finally {
    await runtime.dispose();
    rmSync(rolloutDir, { recursive: true, force: true });
  }
});
