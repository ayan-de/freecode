// =============================================================================
// Quota exhaustion tests
// A spent plan arrives as a 429, indistinguishable by status from an ordinary
// rate limit, and the AI SDK hides it inside AI_RetryError. Both had to be
// handled before a "you are out of credits" reply could stop being retried.
// =============================================================================

import test from "node:test";
import assert from "node:assert/strict";
import {
  isQuotaExhaustedError,
  isTransientError,
  getErrorStatus,
  describeProviderError,
  createRecoveryManager,
} from "./manager.js";

// Shaped like an AI SDK APICallError.
function apiError(message: string, statusCode = 429) {
  return Object.assign(new Error(message), { statusCode });
}

// Shaped like AI_RetryError: no status of its own, real errors in `errors[]`.
function retryError(inner: Error, attempts = 3) {
  return Object.assign(
    new Error(
      `Failed after ${attempts} attempts. Last error: ${inner.message}`,
    ),
    {
      name: "AI_RetryError",
      errors: [inner, inner, inner],
      reason: "maxRetriesExceeded",
    },
  );
}

test("detects quota exhaustion across provider wordings", () => {
  const real = [
    // MiniMax — the rejection that motivated this path.
    "Token Plan usage limit reached: Upgrade your Token Plan or purchase Credits for more usage. (2056)",
    // Anthropic
    "Your credit balance is too low to access the Anthropic API",
    // OpenAI
    "You exceeded your current quota, please check your plan and billing details",
    // Gemini
    "Quota exceeded for quota metric 'Generate requests'",
  ];
  for (const message of real) {
    assert.equal(
      isQuotaExhaustedError(apiError(message)),
      true,
      `should detect: ${message}`,
    );
  }
});

test("an ordinary rate limit is not treated as quota exhaustion", () => {
  const transient = [
    "Rate limit exceeded, please retry shortly",
    "MiniMax API error 429: rate limited",
    "Too many requests",
  ];
  for (const message of transient) {
    assert.equal(
      isQuotaExhaustedError(apiError(message)),
      false,
      `should not flag: ${message}`,
    );
    // Still worth waiting out, so the retry budget must stay available.
    assert.equal(isTransientError(apiError(message)), true);
  }
});

test("402 is quota exhaustion regardless of wording", () => {
  assert.equal(isQuotaExhaustedError(apiError("Payment Required", 402)), true);
});

test("a non-429 error is never quota exhaustion", () => {
  assert.equal(isQuotaExhaustedError(apiError("bad request", 400)), false);
  assert.equal(isQuotaExhaustedError(apiError("server error", 500)), false);
});

test("quota exhaustion is not transient", () => {
  const quota = apiError(
    "Token Plan usage limit reached: Upgrade your Token Plan",
  );
  assert.equal(isTransientError(quota), false);
});

// -----------------------------------------------------------------------------
// AI_RetryError unwrapping — the wrapper that hid the 429 in the real failure
// -----------------------------------------------------------------------------

test("status is read through an AI_RetryError wrapper", () => {
  const wrapped = retryError(apiError("Token Plan usage limit reached", 429));
  assert.equal(getErrorStatus(wrapped), 429);
});

test("quota is detected through an AI_RetryError wrapper", () => {
  const wrapped = retryError(
    apiError("Token Plan usage limit reached: Upgrade your Token Plan (2056)"),
  );
  assert.equal(isQuotaExhaustedError(wrapped), true);
  assert.equal(isTransientError(wrapped), false);
});

test("a wrapped transient 429 is still retryable", () => {
  const wrapped = retryError(apiError("rate limited, slow down"));
  assert.equal(isQuotaExhaustedError(wrapped), false);
  assert.equal(isTransientError(wrapped), true);
});

// -----------------------------------------------------------------------------
// Redaction — the raw error carries the whole conversation
// -----------------------------------------------------------------------------

test("describeProviderError does not leak the request body", () => {
  const err = Object.assign(new Error("Token Plan usage limit reached"), {
    statusCode: 429,
    requestBodyValues: {
      messages: [{ role: "user", content: "my private source code" }],
      system: "secret system prompt",
    },
    responseBody: '{"error":{"message":"..."}}',
  });
  const described = describeProviderError(err);
  assert.ok(!described.includes("my private source code"));
  assert.ok(!described.includes("secret system prompt"));
  assert.equal(described, "429: Token Plan usage limit reached");
});

// -----------------------------------------------------------------------------
// End to end through the manager
// -----------------------------------------------------------------------------

test("quota exhaustion is not retried and reports cleanly", async () => {
  let attempts = 0;
  const manager = createRecoveryManager();
  const quota = Object.assign(
    new Error(
      "Token Plan usage limit reached: Upgrade your Token Plan or purchase Credits for more usage. (2056)",
    ),
    {
      statusCode: 429,
      requestBodyValues: { messages: [{ content: "my private source code" }] },
    },
  );

  await assert.rejects(
    () =>
      manager.callProvider(
        "minimax",
        async () => {
          attempts++;
          throw quota;
        },
        { sessionId: "s-quota" },
      ),
    (err: Error) => {
      // A plain Error, so nothing downstream can print the request body.
      assert.equal(err.constructor, Error);
      assert.ok(!("requestBodyValues" in err));
      assert.ok(!err.message.includes("my private source code"));
      assert.match(err.message, /quota exhausted/i);
      assert.match(err.message, /fallbackProviders/);
      return true;
    },
  );

  // The whole point: no re-sending the conversation for a guaranteed refusal.
  assert.equal(attempts, 1);
});

test("quota on the primary still falls over to another provider", async () => {
  const seen: string[] = [];
  const manager = createRecoveryManager({ fallbackProviders: ["anthropic"] });

  const result = await manager.callProvider(
    "minimax",
    async (provider) => {
      seen.push(provider);
      if (provider === "minimax") {
        throw Object.assign(
          new Error("Token Plan usage limit reached: Upgrade your Token Plan"),
          { statusCode: 429 },
        );
      }
      return "ok";
    },
    { sessionId: "s-quota-fallback" },
  );

  assert.equal(result, "ok");
  // One attempt each: the primary is not retried, the fallback answers.
  assert.deepEqual(seen, ["minimax", "anthropic"]);
});
