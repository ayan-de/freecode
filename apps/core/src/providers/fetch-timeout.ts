// =============================================================================
// Provider request timeouts, applied at the fetch layer.
//
// WHY HERE AND NOT AROUND THE CHUNK STREAM
//
// The first version of this bounded silence between `ProviderChunk`s — i.e.
// downstream of `normalizeAiSdkStream`, which forwards 5 part types and drops
// the rest. The AI SDK streams a tool call's *arguments* as `tool-input-delta`
// parts and only emits `tool-call` once they are complete, so a model writing
// a large file produced a continuous stream at the wire and total silence at
// that measurement point. The guard would abort a perfectly healthy request
// mid-write. Thinking phases, `start-step`, and keep-alives were invisible for
// the same reason.
//
// Liveness has to be measured where the bytes are. This wraps `fetch` below
// the SDK, so every SSE event counts — including keep-alives that carry no
// content. Same structure opencode arrived at (`provider/provider.ts`:
// `timeoutController` + `wrapSSE`).
//
// TWO INDEPENDENT BOUNDS
//
// - Headers: how long the provider may take to *answer at all*. Cleared the
//   instant headers arrive, so it never constrains generation time.
// - SSE read: how long the socket may be completely silent once streaming has
//   begun. Not a token budget — a slow model that keeps the stream warm is
//   healthy and must survive this.
// =============================================================================

/** How long a provider may take to return response headers. */
export const DEFAULT_HEADER_TIMEOUT_MS = 300_000;
/**
 * How long a live stream may go without a single byte. Generous on purpose:
 * this fires only when a socket is open and completely silent, which no
 * healthy provider does — reasoning models still emit SSE keep-alives.
 */
export const DEFAULT_SSE_STALL_TIMEOUT_MS = 180_000;

const ENV_HEADER = "FREECODE_HEADER_TIMEOUT_MS";
const ENV_SSE = "FREECODE_SSE_STALL_TIMEOUT_MS";

export class HeaderTimeoutError extends Error {
  readonly timeoutMs: number;
  constructor(timeoutMs: number) {
    super(
      `Provider sent no response headers within ${Math.round(timeoutMs / 1000)}s — ` +
        `treating the request as dead. Set ${ENV_HEADER} to change the limit (0 disables).`,
    );
    this.name = "HeaderTimeoutError";
    this.timeoutMs = timeoutMs;
  }
}

export class StreamStallError extends Error {
  readonly timeoutMs: number;
  constructor(timeoutMs: number) {
    super(
      `Provider stream sent no data for ${Math.round(timeoutMs / 1000)}s — ` +
        `treating the request as stalled. Set ${ENV_SSE} to change the limit (0 disables).`,
    );
    this.name = "StreamStallError";
    this.timeoutMs = timeoutMs;
  }
}

/** True for the errors this module raises, so callers can classify a stall. */
export function isTimeoutError(error: unknown): boolean {
  return (
    error instanceof HeaderTimeoutError || error instanceof StreamStallError
  );
}

function envMs(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

/** Combines abort signals. `AbortSignal.any` is Node 20+; this package targets 18. */
function anySignal(signals: AbortSignal[]): AbortSignal | undefined {
  if (signals.length === 0) return undefined;
  if (signals.length === 1) return signals[0];
  const controller = new AbortController();
  for (const signal of signals) {
    if (signal.aborted) {
      controller.abort(signal.reason);
      break;
    }
    signal.addEventListener("abort", () => controller.abort(signal.reason), {
      once: true,
    });
  }
  return controller.signal;
}

/**
 * Re-wraps an SSE response so each read from the body is bounded.
 *
 * Non-SSE responses pass through untouched — a normal JSON body is already
 * covered by the header timeout, and re-streaming it would only add risk.
 */
function wrapSSE(
  response: Response,
  timeoutMs: number,
  controller: AbortController,
): Response {
  if (timeoutMs <= 0 || !response.body) return response;
  if (!response.headers.get("content-type")?.includes("text/event-stream")) {
    return response;
  }

  const reader = response.body.getReader();
  const body = new ReadableStream<Uint8Array>({
    async pull(target) {
      const result = await new Promise<Awaited<ReturnType<typeof reader.read>>>(
        (resolve, reject) => {
          const timer = setTimeout(() => {
            const error = new StreamStallError(timeoutMs);
            // Abort the request too: cancelling the reader alone can leave the
            // underlying connection open on some runtimes.
            controller.abort(error);
            void reader.cancel(error).catch(() => {});
            reject(error);
          }, timeoutMs);
          timer.unref?.();

          reader.read().then(
            (value) => {
              clearTimeout(timer);
              resolve(value);
            },
            (error) => {
              clearTimeout(timer);
              reject(error);
            },
          );
        },
      );

      if (result.done) {
        target.close();
        return;
      }
      target.enqueue(result.value);
    },
    async cancel(reason) {
      controller.abort(reason);
      await reader.cancel(reason).catch(() => {});
    },
  });

  return new Response(body, {
    headers: new Headers(response.headers),
    status: response.status,
    statusText: response.statusText,
  });
}

export interface TimeoutFetchOptions {
  headerTimeoutMs?: number;
  sseStallTimeoutMs?: number;
  /** Underlying fetch. Overridable for tests and for provider-supplied fetches. */
  fetchImpl?: typeof fetch;
}

type FetchLike = (input: never, init?: never) => Promise<Response>;

/**
 * A `fetch` for the AI SDK provider factories that enforces both bounds.
 *
 * Deliberately does not touch retries or status handling: `RecoveryManager`
 * owns those, and `PROVIDER_MAX_RETRIES` is 0 so the SDK stays out of it.
 */
export function createTimeoutFetch(
  opts: TimeoutFetchOptions = {},
): typeof fetch {
  return async function timeoutFetch(
    input: Parameters<typeof fetch>[0],
    init?: Parameters<typeof fetch>[1],
  ): Promise<Response> {
    const headerMs =
      opts.headerTimeoutMs ?? envMs(ENV_HEADER, DEFAULT_HEADER_TIMEOUT_MS);
    const sseMs =
      opts.sseStallTimeoutMs ?? envMs(ENV_SSE, DEFAULT_SSE_STALL_TIMEOUT_MS);

    const streamController = sseMs > 0 ? new AbortController() : undefined;
    const headerController = headerMs > 0 ? new AbortController() : undefined;
    const headerTimer =
      headerController &&
      setTimeout(
        () => headerController.abort(new HeaderTimeoutError(headerMs)),
        headerMs,
      );
    headerTimer?.unref?.();

    const signals: AbortSignal[] = [];
    if (init?.signal) signals.push(init.signal);
    if (streamController) signals.push(streamController.signal);
    if (headerController) signals.push(headerController.signal);

    let response: Response;
    try {
      response = await ((opts.fetchImpl ?? fetch) as FetchLike)(
        input as never,
        {
          ...(init as object),
          signal: anySignal(signals),
        } as never,
      );
    } catch (error) {
      // An abort surfaces as a generic DOMException; restate it as the timeout
      // it actually was so the log and the user see a cause, not "aborted".
      if (headerController?.signal.aborted) {
        const reason = headerController.signal.reason;
        throw reason instanceof HeaderTimeoutError
          ? reason
          : new HeaderTimeoutError(headerMs);
      }
      throw error;
    } finally {
      // Headers are in. Generation time is bounded by the SSE reader, not this.
      clearTimeout(headerTimer);
    }

    return streamController
      ? wrapSSE(response, sseMs, streamController)
      : response;
  };
}
