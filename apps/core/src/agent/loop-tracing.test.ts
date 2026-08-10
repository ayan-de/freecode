// =============================================================================
// End-to-end proof that the agent loop traces its own provider calls, and that
// a silent provider is killed instead of hanging the run forever.
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
          cacheCreationInputTokens: 0,
        },
      };
    },
  }),
});

// Accepts the connection and then says nothing — the exact failure the stall
// guard exists for. Never resolves on its own.
registerProvider("stall-fake" as ProviderId, {
  info: info("stall-fake"),
  create: (): AIProvider => ({
    info: info("stall-fake"),
    execute: async () => done,
    stream: async function* (opts): AsyncGenerator<ProviderChunk> {
      // Honours abortSignal exactly as the real adapters do, which is what
      // makes this a faithful test of the guard's kill path rather than of a
      // generator that politely gives up on its own.
      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, 30_000);
        opts.abortSignal?.addEventListener("abort", () => {
          clearTimeout(timer);
          reject(new Error("aborted"));
        });
      });
      yield { type: "text_delta", delta: "too late" };
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

test("a silent provider is cut off and recorded as a stall, not left hanging", async () => {
  const previous = process.env.FREECODE_FIRST_CHUNK_TIMEOUT_MS;
  process.env.FREECODE_FIRST_CHUNK_TIMEOUT_MS = "150";
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

    // Before the guard existed this call never returned at all.
    assert.ok(
      elapsed < 20_000,
      `loop returned in ${elapsed}ms instead of hanging`,
    );

    const events = readEvents(rolloutDir);
    assert.ok(events.some((e) => e.type === "model.request"));
    assert.ok(
      !events.some((e) => e.type === "model.first_token"),
      "nothing was ever received, so there is no first token",
    );
    const error = events.find((e) => e.type === "model.error");
    assert.ok(error, "the stall was recorded");
    assert.equal(error!.kind, "stall");
    assert.match(String(error!.error), /no response/);
  } finally {
    await runtime.dispose();
    rmSync(rolloutDir, { recursive: true, force: true });
    if (previous === undefined)
      delete process.env.FREECODE_FIRST_CHUNK_TIMEOUT_MS;
    else process.env.FREECODE_FIRST_CHUNK_TIMEOUT_MS = previous;
  }
});
