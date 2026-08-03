// =============================================================================
// RecoveryManager — transient-error retry + provider fallback (Phase 4)
// PRIMARY: Keeps sessions alive through 429s, 5xx, and network timeouts
// INPUT: provider call thunk + RecoveryContext (sessionId, AbortSignal)
// OUTPUT: result of the first successful attempt, or the last error after the
//         retry budget and fallback chain are exhausted
// FLOW: classify error → policy (429 / transient / fatal) → Effect retry with
//       backoff → next provider in the fallback chain → SessionError on Bus
// SPEC: RecoveryPolicy shape from docs/superpowers/specs/2026-05-25-agent-loop.md
// =============================================================================

import { Effect } from "effect";
import { BusEvents } from "../../bus/index.js";
import { readConfig } from "../../providers/config.js";
import { logger } from "../../utils/logger.js";

// =============================================================================
// RecoveryPolicy — per spec (2026-05-25-agent-loop.md:475-487)
// =============================================================================

export interface RecoveryPolicy {
  canRecover(error: unknown): boolean;
  strategy:
    | "retry" // Effect retry with backoff
    | "restart-provider" // Reinitialize provider
    | "restart-browser" // Reconnect Playwright
    | "rollback-turn" // Restore turn state
    | "abort-session"; // Fatal, end session
  maxAttempts: number;
  initialDelay?: number;
  backoff?: "linear" | "exponential" | "fixed";
  fallbackTool?: string;
}

// =============================================================================
// Error classification
// Providers surface errors three ways: AI SDK APICallError (statusCode),
// MiniMax fetch errors ("MiniMax API error 429: ..."), and Node network
// errors (code ECONNRESET etc., possibly nested under cause).
// =============================================================================

/**
 * The AI SDK wraps a failed call in `AI_RetryError`, which carries the real
 * `APICallError`s in `errors[]` and exposes no status of its own. Reading the
 * wrapper directly makes every nested 429/5xx look statusless, so a rate limit
 * is misread as fatal. Unwrap to the last real error before classifying.
 */
function unwrapProviderError(error: unknown): unknown {
  if (!error || typeof error !== "object") return error;
  const anyErr = error as { lastError?: unknown; errors?: unknown };
  if (anyErr.lastError) return unwrapProviderError(anyErr.lastError);
  if (Array.isArray(anyErr.errors) && anyErr.errors.length > 0) {
    return unwrapProviderError(anyErr.errors[anyErr.errors.length - 1]);
  }
  return error;
}

export function getErrorStatus(error: unknown): number | undefined {
  const unwrapped = unwrapProviderError(error);
  if (unwrapped && typeof unwrapped === "object") {
    const anyErr = unwrapped as Record<string, unknown>;
    if (typeof anyErr.statusCode === "number") return anyErr.statusCode;
    if (typeof anyErr.status === "number") return anyErr.status;
  }
  const msg = String((unwrapped as Error)?.message ?? unwrapped ?? "");
  const match = msg.match(/(?:API error|status(?:\s+code)?)[:\s]+(\d{3})/i);
  return match ? Number(match[1]) : undefined;
}

export function isAbortError(error: unknown): boolean {
  if (!error) return false;
  const name = (error as Error)?.name ?? "";
  const msg = String((error as Error)?.message ?? error).toLowerCase();
  return name === "AbortError" || msg.includes("abort");
}

// Every provider words "your request is longer than the window" differently,
// and all of them return a plain 400 that is indistinguishable by status from
// a malformed request. Matching the message is the only portable signal.
//   MiniMax:   invalid params, context window exceeds limit (2013)
//   Anthropic: prompt is too long: N tokens > M maximum
//   OpenAI:    context_length_exceeded / maximum context length is N tokens
//   Gemini:    input token count exceeds the maximum
const CONTEXT_OVERFLOW_PATTERNS = [
  "context window exceeds",
  "context length",
  "context_length_exceeded",
  "prompt is too long",
  "prompt_too_long",
  "input token count",
  "too many total tokens",
];

/**
 * Whether a provider rejected the request because the conversation no longer
 * fits. Distinct from a rate limit or a transient fault: retrying unchanged
 * will always fail, so the only recovery is to make the request smaller.
 *
 * Deliberately narrow — a false positive costs a needless compaction, and
 * compaction discards message detail, so an unrelated 400 must not trigger it.
 */
export function isContextOverflowError(error: unknown): boolean {
  if (!error) return false;
  const status = getErrorStatus(error);
  // 413 is rare here but unambiguous; otherwise these arrive as 400. Anything
  // 5xx is a server fault, not an oversized prompt.
  if (status !== undefined && status !== 400 && status !== 413) return false;
  const msg = String((error as Error)?.message ?? error).toLowerCase();
  return CONTEXT_OVERFLOW_PATTERNS.some((pattern) => msg.includes(pattern));
}

// A quota rejection arrives as a 429, exactly like a transient rate limit, and
// providers word it differently. Only the message separates "slow down" from
// "your plan is spent" — and the difference matters: one is worth waiting out,
// the other can never succeed no matter how long we back off.
//   MiniMax:   Token Plan usage limit reached: Upgrade your Token Plan (2056)
//   Anthropic: credit balance is too low
//   OpenAI:    You exceeded your current quota, please check your plan
//   Gemini:    Quota exceeded / billing
const QUOTA_EXHAUSTED_PATTERNS = [
  "usage limit reached",
  "quota",
  "insufficient credit",
  "credit balance",
  "billing",
  "upgrade your",
  "purchase credits",
  "payment required",
  "exceeded your current",
];

/**
 * Whether a provider refused because the account is out of allowance, rather
 * than because it is momentarily busy. Retrying is pointless — every attempt
 * re-sends the whole conversation for a guaranteed rejection — so this is
 * treated as fatal and short-circuits the retry budget entirely.
 *
 * Narrow by design: a false positive turns a recoverable rate limit into a
 * dead turn, so an unlabelled 429 keeps the benefit of the doubt and retries.
 */
export function isQuotaExhaustedError(error: unknown): boolean {
  if (!error) return false;
  const status = getErrorStatus(error);
  // 402 is unambiguous; the rest arrive as 429 alongside ordinary rate limits.
  if (status !== undefined && status !== 429 && status !== 402) return false;
  if (status === 402) return true;
  const msg = String(
    (unwrapProviderError(error) as Error)?.message ?? error,
  ).toLowerCase();
  return QUOTA_EXHAUSTED_PATTERNS.some((pattern) => msg.includes(pattern));
}

/**
 * A provider error carries the entire request on `requestBodyValues` — every
 * message, the system prompt and all tool schemas. Printing the raw object
 * spills the whole conversation into the terminal and buries the one line that
 * matters. Returns just that line.
 */
export function describeProviderError(error: unknown): string {
  const unwrapped = unwrapProviderError(error);
  const message = String((unwrapped as Error)?.message ?? unwrapped ?? "");
  const status = getErrorStatus(error);
  return status !== undefined ? `${status}: ${message}` : message;
}

const NETWORK_ERROR_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "EAI_AGAIN",
  "ENOTFOUND",
  "EPIPE",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_SOCKET",
]);

function getErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined;
  const anyErr = error as { code?: unknown; cause?: { code?: unknown } };
  const code = anyErr.code ?? anyErr.cause?.code;
  return typeof code === "string" ? code : undefined;
}

export function isTransientError(error: unknown): boolean {
  if (isAbortError(error)) return false; // user interrupt is never retried
  if (isQuotaExhaustedError(error)) return false; // no amount of waiting helps
  const status = getErrorStatus(error);
  if (status === 429) return true;
  if (status !== undefined) return status >= 500; // other 4xx = fatal
  const code = getErrorCode(error);
  if (code && NETWORK_ERROR_CODES.has(code)) return true;
  const msg = String((error as Error)?.message ?? error ?? "").toLowerCase();
  return (
    msg.includes("fetch failed") ||
    msg.includes("timeout") ||
    msg.includes("network")
  );
}

// =============================================================================
// Default policies (spec ERROR_POLICIES, reduced to the classes providers
// actually produce today — no Playwright/MCP surface in the provider path)
// =============================================================================

export interface RecoveryPolicies {
  http429: RecoveryPolicy;
  transient: RecoveryPolicy;
}

export const DEFAULT_POLICIES: RecoveryPolicies = {
  http429: {
    canRecover: (e) => getErrorStatus(e) === 429,
    strategy: "retry",
    maxAttempts: 5,
    initialDelay: 5000,
    backoff: "exponential",
  },
  transient: {
    canRecover: isTransientError,
    strategy: "retry",
    maxAttempts: 3,
    initialDelay: 1000,
    backoff: "exponential",
  },
};

const MAX_DELAY_MS = 30_000;

function selectPolicy(
  error: unknown,
  policies: RecoveryPolicies,
): RecoveryPolicy | undefined {
  // Checked before the 429 policy: a spent quota is also a 429, but retrying
  // it just re-sends the conversation five times for the same rejection.
  if (isQuotaExhaustedError(error)) return undefined;
  if (getErrorStatus(error) === 429) return policies.http429;
  if (isTransientError(error)) return policies.transient;
  return undefined; // fatal — no retry, straight to fallback chain
}

// Providers (AI SDK APICallError) return the exact wait on a 429 via
// standard rate-limit headers; honor it over our own backoff guess when present.
function retryAfterMs(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined;
  const headers = (error as { responseHeaders?: Record<string, string> })
    .responseHeaders;
  if (!headers) return undefined;

  const ms = headers["retry-after-ms"];
  if (ms) {
    const parsed = Number.parseFloat(ms);
    if (!Number.isNaN(parsed)) return parsed;
  }

  const seconds = headers["retry-after"];
  if (seconds) {
    const parsedSeconds = Number.parseFloat(seconds);
    if (!Number.isNaN(parsedSeconds)) return parsedSeconds * 1000;
    const parsedDate = Date.parse(seconds) - Date.now();
    if (!Number.isNaN(parsedDate) && parsedDate > 0) return parsedDate;
  }

  return undefined;
}

function computeDelay(
  policy: RecoveryPolicy,
  attempt: number,
  error?: unknown,
): number {
  const fromHeader = retryAfterMs(error);
  if (fromHeader !== undefined) return Math.min(fromHeader, MAX_DELAY_MS);

  const initial = policy.initialDelay ?? 1000;
  const delay =
    policy.backoff === "fixed"
      ? initial
      : policy.backoff === "linear"
        ? initial * attempt
        : initial * 2 ** (attempt - 1); // exponential (default)
  return Math.min(delay, MAX_DELAY_MS);
}

// Sleep that rejects immediately when the signal aborts, so a user interrupt
// is never stuck behind a 5s backoff delay.
function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

// Reads as advice rather than a stack trace: the session is already persisted,
// so the useful next step is topping up or switching provider, not debugging.
function quotaExhaustedMessage(chain: string[], error: unknown): string {
  const tried =
    chain.length > 1 ? `all providers [${chain.join(", ")}]` : `"${chain[0]}"`;
  const detail = describeProviderError(error);
  const hint =
    chain.length > 1
      ? "Top up an account, or add another provider to recovery.fallbackProviders."
      : `Top up "${chain[0]}", or set recovery.fallbackProviders in ~/.freecode/config.json to fail over automatically.`;
  return `Provider quota exhausted on ${tried}. ${hint}\nProvider said — ${detail}`;
}

// =============================================================================
// RecoveryManager
// =============================================================================

export interface RecoveryContext {
  sessionId: string;
  signal?: AbortSignal;
}

export interface RecoveryManagerOptions {
  // Providers to try, in order, after the primary exhausts its retry budget
  // or hits a fatal error. Config-driven via ~/.freecode/config.json.
  fallbackProviders?: string[];
  policies?: Partial<RecoveryPolicies>;
  // Test seam / observability: called before each backoff sleep.
  onRetry?: (info: {
    provider: string;
    attempt: number;
    delayMs: number;
    error: unknown;
  }) => void;
}

export interface RecoveryManager {
  // Run a provider call with retry + fallback. attempt() receives the provider
  // id so the caller can re-resolve the adapter (and drop the primary-specific
  // model when falling back).
  callProvider<T>(
    primaryProvider: string,
    attempt: (provider: string) => Promise<T>,
    ctx: RecoveryContext,
  ): Promise<T>;
  // Tool retry rule: non-mutating tools retry transient failures, mutating
  // tools never do (re-running a write/edit/bash is not safe).
  shouldRetryTool(
    behavior: { isDestructive: boolean } | undefined,
    error: unknown,
  ): boolean;
}

export function createRecoveryManager(
  options: RecoveryManagerOptions = {},
): RecoveryManager {
  const policies: RecoveryPolicies = {
    http429: options.policies?.http429 ?? DEFAULT_POLICIES.http429,
    transient: options.policies?.transient ?? DEFAULT_POLICIES.transient,
  };
  const fallbacks = options.fallbackProviders ?? [];

  // One provider's attempt loop: try → classify → backoff → retry, as an
  // Effect so the whole recovery pipeline stays composable/interruptible.
  const runProviderWithRetry = <T>(
    provider: string,
    attemptFn: (provider: string) => Promise<T>,
    ctx: RecoveryContext,
  ): Effect.Effect<T, unknown> =>
    Effect.gen(function* () {
      for (let attempt = 1; ; attempt++) {
        const outcome = yield* Effect.tryPromise({
          try: () => attemptFn(provider),
          catch: (e) => e,
        }).pipe(Effect.either);

        if (outcome._tag === "Right") return outcome.right;

        const error = outcome.left;
        const policy = selectPolicy(error, policies);
        if (
          !policy ||
          !policy.canRecover(error) ||
          ctx.signal?.aborted ||
          attempt >= policy.maxAttempts
        ) {
          return yield* Effect.fail(error);
        }

        const delayMs = computeDelay(policy, attempt, error);
        options.onRetry?.({ provider, attempt, delayMs, error });
        logger.warn(
          `[Recovery] ${provider} attempt ${attempt}/${policy.maxAttempts} failed (${describeProviderError(
            error,
          )}); retrying in ${delayMs}ms`,
        );
        yield* Effect.tryPromise({
          try: () => abortableSleep(delayMs, ctx.signal),
          catch: (e) => e,
        });
      }
    });

  return {
    async callProvider<T>(
      primaryProvider: string,
      attemptFn: (provider: string) => Promise<T>,
      ctx: RecoveryContext,
    ): Promise<T> {
      const chain = [
        primaryProvider,
        ...fallbacks.filter((p) => p !== primaryProvider),
      ];

      let lastError: unknown;
      for (const provider of chain) {
        try {
          return await Effect.runPromise(
            runProviderWithRetry(provider, attemptFn, ctx),
          );
        } catch (error) {
          lastError = error;
          // A user interrupt must stop the whole chain, not trigger fallback.
          if (isAbortError(error) || ctx.signal?.aborted) throw error;
          const next = chain[chain.indexOf(provider) + 1];
          if (next) {
            logger.warn(
              `[Recovery] provider "${provider}" exhausted (${describeProviderError(
                error,
              )}); falling back to "${next}"`,
            );
          }
        }
      }

      // Quota exhaustion is a billing state, not a bug: say what happened and
      // what fixes it. Throwing a plain Error also drops the SDK error's
      // `requestBodyValues`, so nothing downstream — logs, the bus, or a crash
      // report — can spill the conversation while reporting this.
      if (isQuotaExhaustedError(lastError)) {
        const message = quotaExhaustedMessage(chain, lastError);
        BusEvents.sessionError(ctx.sessionId, message);
        throw new Error(message);
      }

      BusEvents.sessionError(
        ctx.sessionId,
        `Recovery exhausted across providers [${chain.join(", ")}]: ${describeProviderError(
          lastError,
        )}`,
      );
      throw lastError;
    },

    shouldRetryTool(behavior, error): boolean {
      if (!behavior || behavior.isDestructive) return false;
      return isTransientError(error);
    },
  };
}

// Config-driven construction: fallback chain comes from
// ~/.freecode/config.json → { recovery: { fallbackProviders: [...] } }.
export function createRecoveryManagerFromConfig(): RecoveryManager {
  const config = readConfig();
  return createRecoveryManager({
    fallbackProviders: config.recovery?.fallbackProviders ?? [],
  });
}
