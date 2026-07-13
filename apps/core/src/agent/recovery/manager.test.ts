// =============================================================================
// RecoveryManager Tests — Phase 4 success criteria
// 1. Injected 429 storm survives (retries kick in, call succeeds)
// 2. Provider outage triggers fallback within 2 attempts
// 3. Fatal errors skip retries and go straight to fallback
// 4. User abort stops the chain (no retry, no fallback)
// 5. SessionError lands on the Bus when recovery exhausts
// 6. Tool retry rule: non-mutating retries transient, mutating never
// 7. End-to-end: agent loop survives a 429 storm via DI-provided manager
// =============================================================================

import test from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "os";
import { mkdtempSync } from "fs";
import { join } from "path";
import {
  createRecoveryManager,
  isTransientError,
  getErrorStatus,
  type RecoveryPolicies,
} from "./manager.js";
import { bus } from "../../bus/index.js";
import { makeTestLayer } from "../../effect/layers.js";
import { makeRuntime } from "../../effect/runtime.js";
import { SessionStoreTag } from "../../effect/context.js";
import { createAgentLoopEffect } from "../loop.js";
import { registerProvider } from "../../providers/registry.js";
import type { ProviderId } from "../../providers/config.js";
import type { AIProvider, ExecuteResult } from "../../providers/types.js";

// Fast policies so tests don't sleep for real backoff durations.
const FAST_POLICIES: Partial<RecoveryPolicies> = {
  http429: {
    canRecover: (e) => getErrorStatus(e) === 429,
    strategy: "retry",
    maxAttempts: 5,
    initialDelay: 5,
    backoff: "exponential",
  },
  transient: {
    canRecover: isTransientError,
    strategy: "retry",
    maxAttempts: 2,
    initialDelay: 5,
    backoff: "exponential",
  },
};

function http429() {
  return new Error("MiniMax API error 429: rate limited");
}

function connRefused() {
  const err = new Error("fetch failed") as Error & { code: string };
  err.code = "ECONNREFUSED";
  return err;
}

function http401() {
  return new Error("API error 401: invalid api key");
}

// -----------------------------------------------------------------------------
// 1. 429 storm survives
// -----------------------------------------------------------------------------

test("429 storm: retries with backoff until success", async () => {
  const manager = createRecoveryManager({ policies: FAST_POLICIES });
  let calls = 0;
  const result = await manager.callProvider(
    "primary",
    async () => {
      calls++;
      if (calls <= 3) throw http429();
      return "ok";
    },
    { sessionId: "s-429" },
  );

  assert.equal(result, "ok");
  assert.equal(calls, 4, "3 failures + 1 success");
});

// -----------------------------------------------------------------------------
// 2. Provider outage → fallback within 2 attempts
// -----------------------------------------------------------------------------

test("provider outage falls back to secondary within 2 attempts", async () => {
  const manager = createRecoveryManager({
    policies: FAST_POLICIES,
    fallbackProviders: ["secondary"],
  });
  const attempts: string[] = [];
  const result = await manager.callProvider(
    "primary",
    async (provider) => {
      attempts.push(provider);
      if (provider === "primary") throw connRefused();
      return `served-by-${provider}`;
    },
    { sessionId: "s-outage" },
  );

  assert.equal(result, "served-by-secondary");
  assert.deepEqual(attempts, ["primary", "primary", "secondary"]);
});

// -----------------------------------------------------------------------------
// 3. Fatal error: no retry on primary, straight to fallback
// -----------------------------------------------------------------------------

test("fatal 401 skips retries and goes straight to fallback", async () => {
  const manager = createRecoveryManager({
    policies: FAST_POLICIES,
    fallbackProviders: ["secondary"],
  });
  const attempts: string[] = [];
  const result = await manager.callProvider(
    "primary",
    async (provider) => {
      attempts.push(provider);
      if (provider === "primary") throw http401();
      return "fallback-ok";
    },
    { sessionId: "s-fatal" },
  );

  assert.equal(result, "fallback-ok");
  assert.deepEqual(attempts, ["primary", "secondary"], "no retry on 401");
});

// -----------------------------------------------------------------------------
// 4. Abort stops the chain
// -----------------------------------------------------------------------------

test("abort mid-backoff stops retries and skips fallback", async () => {
  const controller = new AbortController();
  const manager = createRecoveryManager({
    policies: {
      ...FAST_POLICIES,
      transient: { ...FAST_POLICIES.transient!, initialDelay: 5_000 },
    },
    fallbackProviders: ["secondary"],
    onRetry: () => setTimeout(() => controller.abort(), 10),
  });
  const attempts: string[] = [];
  const started = Date.now();

  await assert.rejects(
    manager.callProvider(
      "primary",
      async (provider) => {
        attempts.push(provider);
        throw connRefused();
      },
      { sessionId: "s-abort", signal: controller.signal },
    ),
  );

  assert.ok(Date.now() - started < 1_000, "did not sit out the 5s backoff");
  assert.deepEqual(attempts, ["primary"], "no fallback after user abort");
});

// -----------------------------------------------------------------------------
// 5. SessionError on the Bus when recovery exhausts
// -----------------------------------------------------------------------------

test("emits session.error on the bus when all providers exhaust", async () => {
  const manager = createRecoveryManager({
    policies: FAST_POLICIES,
    fallbackProviders: ["secondary"],
  });
  const errors: string[] = [];
  const unsubscribe = bus.subscribe("session.error", (e) =>
    errors.push(`${e.sessionId}: ${e.error}`),
  );
  try {
    await assert.rejects(
      manager.callProvider(
        "primary",
        async () => {
          throw connRefused();
        },
        { sessionId: "s-exhausted" },
      ),
    );
  } finally {
    unsubscribe();
  }

  assert.equal(errors.length, 1);
  assert.match(errors[0], /^s-exhausted: Recovery exhausted/);
  assert.match(errors[0], /primary, secondary/);
});

// -----------------------------------------------------------------------------
// 6. Tool retry rule
// -----------------------------------------------------------------------------

test("shouldRetryTool: non-mutating retries transient, mutating never", () => {
  const manager = createRecoveryManager();
  assert.equal(
    manager.shouldRetryTool({ isDestructive: false }, connRefused()),
    true,
  );
  assert.equal(
    manager.shouldRetryTool({ isDestructive: true }, connRefused()),
    false,
  );
  assert.equal(
    manager.shouldRetryTool({ isDestructive: false }, http401()),
    false,
    "fatal errors never retried",
  );
  assert.equal(manager.shouldRetryTool(undefined, connRefused()), false);
});

// -----------------------------------------------------------------------------
// 7. End-to-end: agent loop survives a 429 storm
// -----------------------------------------------------------------------------

const doneResult: ExecuteResult = {
  content: "Recovered fine.",
  stopReason: "stop",
  provider: "test-429",
  model: "fake-model",
  usage: { inputTokens: 1, outputTokens: 1 },
};

let flakyCalls = 0;
registerProvider("test-429" as ProviderId, {
  info: {
    id: "test-429",
    name: "test-429",
    defaultModel: "fake-model",
    supportsStreaming: false,
    supportsTools: false,
  },
  create: (): AIProvider => ({
    info: {
      id: "test-429",
      name: "test-429",
      defaultModel: "fake-model",
      supportsStreaming: false,
      supportsTools: false,
    },
    execute: async () => {
      flakyCalls++;
      if (flakyCalls <= 2) throw http429();
      return doneResult;
    },
  }),
});

test("agent loop session continues through a 429 storm", async () => {
  const sessionId = "loop-429-session";
  const runtime = makeRuntime(
    makeTestLayer({
      recoveryManager: createRecoveryManager({ policies: FAST_POLICIES }),
    }),
  );
  try {
    const projectPath = mkdtempSync(join(tmpdir(), "freecode-recovery-test-"));
    const store = await runtime.runPromise(SessionStoreTag);
    await store.createSession(
      { title: "test", projectPath, provider: "test-429" },
      sessionId,
    );
    const loop = await runtime.runPromise(
      createAgentLoopEffect(sessionId, { maxIterations: 3 }),
    );

    flakyCalls = 0;
    const result = await loop.run({
      prompt: "trigger the storm",
      sessionId,
      provider: "test-429",
      projectPath,
    });

    assert.equal(result.success, true);
    assert.equal(result.content, "Recovered fine.");
    assert.equal(flakyCalls, 3, "two 429s absorbed by retries");
  } finally {
    await runtime.dispose();
  }
});
