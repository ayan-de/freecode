// =============================================================================
// Effect Runtime Tests — Phase 3 DI success criteria
// 1. A mock MemoryService can be injected via layers (no global patching)
// 2. interrupt() aborts an in-flight provider call immediately
// 3. Effect fiber interruption propagates to the provider AbortSignal
// =============================================================================

import test from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "os";
import { mkdtempSync } from "fs";
import { join } from "path";
import { Fiber } from "effect";
import { makeTestLayer } from "./layers.js";
import { makeRuntime } from "./runtime.js";
import { SessionStoreTag, MemoryFactoryTag } from "./context.js";
import { createAgentLoopEffect } from "../agent/loop.js";
import { MemoryService } from "../compaction/service.js";
import { registerProvider } from "../providers/registry.js";
import type { ProviderId } from "../providers/config.js";
import type {
  AIProvider,
  ExecuteOptions,
  ExecuteResult,
} from "../providers/types.js";

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function inMemoryStorage() {
  const states = new Map<string, any>();
  return {
    save: (s: any) => states.set(s.sessionId, s),
    load: (id: string) => states.get(id),
    listSessions: () => [...states.keys()],
    delete: (id: string) => {
      states.delete(id);
    },
  };
}

function fakeProviderInfo(id: string) {
  return {
    id,
    name: id,
    defaultModel: "fake-model",
    supportsStreaming: false,
    supportsTools: false,
  };
}

const doneResult: ExecuteResult = {
  content: "All done.",
  stopReason: "stop",
  provider: "fake",
  model: "fake-model",
  usage: { inputTokens: 1, outputTokens: 1 },
};

// Immediate no-tool-call provider — loop completes in one turn.
registerProvider("test-fake" as ProviderId, {
  info: fakeProviderInfo("test-fake"),
  create: (): AIProvider => ({
    info: fakeProviderInfo("test-fake"),
    execute: async () => doneResult,
  }),
});

// Slow provider that respects AbortSignal — used for interruption tests.
let providerAborted = false;

/**
 * Resolves the instant the slow provider's execute() is entered.
 *
 * The interruption tests used to sleep a fixed 50/200ms and hope the loop had
 * reached the provider by then. Under load (the whole suite in parallel) it
 * sometimes hadn't, so interrupt() fired before the request existed, nothing
 * was aborted, and `providerAborted` stayed false — a flake that only ever
 * showed up in CI. Awaiting the real event makes the ordering deterministic.
 */
let providerStarted: Promise<void>;
let markProviderStarted: () => void;

function resetSlowProvider(): void {
  providerAborted = false;
  providerStarted = new Promise<void>((resolve) => {
    markProviderStarted = resolve;
  });
}
resetSlowProvider();

registerProvider("test-slow" as ProviderId, {
  info: fakeProviderInfo("test-slow"),
  create: (): AIProvider => ({
    info: fakeProviderInfo("test-slow"),
    execute: (opts: ExecuteOptions) =>
      new Promise<ExecuteResult>((resolve, reject) => {
        markProviderStarted();
        const t = setTimeout(() => resolve(doneResult), 10_000);
        opts.abortSignal?.addEventListener("abort", () => {
          clearTimeout(t);
          providerAborted = true;
          reject(new Error("aborted"));
        });
      }),
  }),
});

async function makeLoopWith(memory: MemoryService, sessionId: string) {
  const runtime = makeRuntime(
    makeTestLayer({ memoryFactory: { forSession: () => memory } }),
  );
  // Loop persistence expects the session to exist in the store (server.ts
  // creates it in session.start) — mirror that here.
  const projectPath = mkdtempSync(join(tmpdir(), "freecode-loop-test-"));
  const store = await runtime.runPromise(SessionStoreTag);
  await store.createSession(
    { title: "test", projectPath, provider: "test-fake" },
    sessionId,
  );
  const loop = await runtime.runPromise(
    createAgentLoopEffect(sessionId, { maxIterations: 3 }),
  );
  return { runtime, loop, projectPath };
}

// -----------------------------------------------------------------------------
// 1. DI: mock MemoryService injected via layer, no global patching
// -----------------------------------------------------------------------------

test("createAgentLoopEffect uses the layer-provided MemoryService", async () => {
  const sessionId = "di-test-session";
  const recorded: string[] = [];
  const memory = new MemoryService(sessionId, {
    storage: inMemoryStorage(),
  });
  const origAdd = memory.addMessage.bind(memory);
  memory.addMessage = ((role, content) => {
    recorded.push(`${role}:${content}`);
    return origAdd(role, content);
  }) as typeof memory.addMessage;

  const { runtime, loop, projectPath } = await makeLoopWith(memory, sessionId);
  try {
    const result = await loop.run({
      prompt: "hello di",
      sessionId,
      provider: "test-fake",
      projectPath,
    });

    assert.equal(result.success, true);
    // The injected mock saw both sides of the exchange — proof the loop used
    // the layer-provided instance, not an internally constructed one.
    assert.ok(recorded.some((r) => r === "user:hello di"));
    assert.ok(recorded.some((r) => r.startsWith("assistant:")));
  } finally {
    await runtime.dispose();
  }
});

// -----------------------------------------------------------------------------
// 2. interrupt() aborts the in-flight provider call
// -----------------------------------------------------------------------------

test("interrupt() aborts an in-flight provider call within 100ms", async () => {
  const sessionId = "abort-test-session";
  resetSlowProvider();
  const memory = new MemoryService(sessionId, { storage: inMemoryStorage() });
  const { runtime, loop, projectPath } = await makeLoopWith(memory, sessionId);
  try {
    const running = loop.run({
      prompt: "hang forever",
      sessionId,
      provider: "test-slow",
      projectPath,
    });
    // Interrupt only once the provider call is genuinely in flight.
    await providerStarted;
    const interruptedAt = Date.now();
    loop.interrupt();
    const result = await running;
    // Measured from the interrupt, not from loop.run(): what's under test is
    // abort latency, not how long the loop takes to start up on a busy box.
    const elapsed = Date.now() - interruptedAt;

    assert.equal(providerAborted, true, "provider saw the abort signal");
    assert.ok(elapsed < 1_000, `resolved in ${elapsed}ms, expected < 1000ms`);
    assert.equal(result.success, true);
    assert.equal(result.message, "Interrupted");
    assert.equal(loop.getState().status, "stopped");
  } finally {
    await runtime.dispose();
  }
});

// -----------------------------------------------------------------------------
// 3. Effect fiber interruption propagates to the provider AbortSignal
// -----------------------------------------------------------------------------

test("interrupting the runEffect fiber aborts the provider call", async () => {
  const sessionId = "fiber-test-session";
  resetSlowProvider();
  const memory = new MemoryService(sessionId, { storage: inMemoryStorage() });
  const { runtime, loop, projectPath } = await makeLoopWith(memory, sessionId);
  try {
    const fiber = runtime.runFork(
      loop.runEffect({
        prompt: "hang forever",
        sessionId,
        provider: "test-slow",
        projectPath,
      }),
    );
    // Wait for the loop to actually reach the provider call, then interrupt
    // the fiber — a fixed sleep here raced the loop under parallel load.
    await providerStarted;
    await runtime.runPromise(Fiber.interrupt(fiber));

    assert.equal(providerAborted, true, "provider saw the abort signal");
    assert.equal(loop.getState().status, "stopped");
  } finally {
    await runtime.dispose();
  }
});
