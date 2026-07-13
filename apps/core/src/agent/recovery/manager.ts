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

export function getErrorStatus(error: unknown): number | undefined {
  if (error && typeof error === "object") {
    const anyErr = error as Record<string, unknown>;
    if (typeof anyErr.statusCode === "number") return anyErr.statusCode;
    if (typeof anyErr.status === "number") return anyErr.status;
  }
  const msg = String((error as Error)?.message ?? error ?? "");
  const match = msg.match(/(?:API error|status(?:\s+code)?)[:\s]+(\d{3})/i);
  return match ? Number(match[1]) : undefined;
}

export function isAbortError(error: unknown): boolean {
  if (!error) return false;
  const name = (error as Error)?.name ?? "";
  const msg = String((error as Error)?.message ?? error).toLowerCase();
  return name === "AbortError" || msg.includes("abort");
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
  if (getErrorStatus(error) === 429) return policies.http429;
  if (isTransientError(error)) return policies.transient;
  return undefined; // fatal — no retry, straight to fallback chain
}

function computeDelay(policy: RecoveryPolicy, attempt: number): number {
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

        const delayMs = computeDelay(policy, attempt);
        options.onRetry?.({ provider, attempt, delayMs, error });
        console.warn(
          `[Recovery] ${provider} attempt ${attempt}/${policy.maxAttempts} failed (${String(
            (error as Error)?.message ?? error,
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
            console.warn(
              `[Recovery] provider "${provider}" exhausted (${String(
                (error as Error)?.message ?? error,
              )}); falling back to "${next}"`,
            );
          }
        }
      }

      BusEvents.sessionError(
        ctx.sessionId,
        `Recovery exhausted across providers [${chain.join(", ")}]: ${String(
          (lastError as Error)?.message ?? lastError,
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
