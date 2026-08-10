// =============================================================================
// Stream stall guard — bounds how long a provider is allowed to go silent.
//
// Providers are given an abortSignal and PROVIDER_MAX_RETRIES=0, but nothing
// ever bounded a request's *duration*. A provider that accepts the connection
// and then stops producing chunks parks the agent loop forever: no error, no
// timeout, no event. In the TUI that renders as the last tool call sitting
// there "in progress" — the loop is not stuck on the tool, it is stuck waiting
// on a stream that will never finish.
//
// The bound is on silence, not on total time. A long reasoning turn that keeps
// emitting thinking deltas is healthy and must not be killed; a stream that
// says nothing for a minute is not.
// =============================================================================

/** No first chunk within this long and the request is considered dead. */
export const DEFAULT_FIRST_CHUNK_TIMEOUT_MS = 120_000;
/** Gap between chunks, once the stream has started producing. */
export const DEFAULT_STALL_TIMEOUT_MS = 60_000;
/**
 * Whole-call budget for the non-streaming `execute()` path, which has no
 * chunks to measure silence between. Generous, because it has to cover a full
 * long-form completion rather than a gap.
 */
export const DEFAULT_REQUEST_TIMEOUT_MS = 300_000;

const ENV_FIRST_CHUNK = "FREECODE_FIRST_CHUNK_TIMEOUT_MS";
const ENV_STALL = "FREECODE_STREAM_STALL_TIMEOUT_MS";
const ENV_REQUEST = "FREECODE_REQUEST_TIMEOUT_MS";

/**
 * Thrown when a stream goes quiet past its budget. Carries how far the stream
 * got, because "stalled before the first chunk" (provider never started) and
 * "stalled after 400 chunks" (provider died mid-generation) have different
 * causes and the message should not blur them.
 */
export class ProviderStallError extends Error {
  readonly timeoutMs: number;
  readonly chunksReceived: number;

  constructor(timeoutMs: number, chunksReceived: number) {
    // Sub-second budgets only come up in tests, but rounding them to "0s"
    // makes the message read like a bug rather than a configured limit.
    const elapsed =
      timeoutMs < 1000 ? `${timeoutMs}ms` : `${Math.round(timeoutMs / 1000)}s`;
    super(
      chunksReceived === 0
        ? `Provider sent no response for ${elapsed} — treating the request as stalled. ` +
            `Set ${ENV_FIRST_CHUNK} to raise the limit.`
        : `Provider stream went silent for ${elapsed} after ${chunksReceived} chunks — ` +
            `treating the request as stalled. Set ${ENV_STALL} to raise the limit.`,
    );
    this.name = "ProviderStallError";
    this.timeoutMs = timeoutMs;
    this.chunksReceived = chunksReceived;
  }
}

/** A positive integer from the environment, or undefined. `0` disables. */
function envMs(name: string): number | undefined {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return undefined;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

/** Whole-call budget for a non-streaming request. 0 disables. */
export function requestTimeoutMs(): number {
  return envMs(ENV_REQUEST) ?? DEFAULT_REQUEST_TIMEOUT_MS;
}

export interface StallOptions {
  /** Budget for the first chunk. 0 disables. */
  firstChunkMs?: number;
  /** Budget for every subsequent chunk. 0 disables. */
  stallMs?: number;
  /** Called once, just before throwing, so the caller can kill the request. */
  onStall?: (error: ProviderStallError) => void;
}

/**
 * Wraps an async iterable so a silent gap longer than the budget throws
 * `ProviderStallError` instead of hanging.
 *
 * The source iterator is closed on every exit path — normal completion, stall,
 * or the consumer breaking out of its `for await`. That close is best-effort:
 * what actually kills a live request is the caller aborting its signal from
 * `onStall`, because closing an async generator suspended inside an `await`
 * does not interrupt that await.
 */
export async function* withStallTimeout<T>(
  source: AsyncIterable<T>,
  opts: StallOptions = {},
): AsyncGenerator<T> {
  const firstChunkMs =
    opts.firstChunkMs ??
    envMs(ENV_FIRST_CHUNK) ??
    DEFAULT_FIRST_CHUNK_TIMEOUT_MS;
  const stallMs = opts.stallMs ?? envMs(ENV_STALL) ?? DEFAULT_STALL_TIMEOUT_MS;

  const iterator = source[Symbol.asyncIterator]();
  let received = 0;

  try {
    for (;;) {
      const budget = received === 0 ? firstChunkMs : stallMs;

      // A zero budget means "no limit" — await the iterator directly rather
      // than racing it against a timer that would never fire anyway.
      if (budget <= 0) {
        const step = await iterator.next();
        if (step.done) return;
        received++;
        yield step.value;
        continue;
      }

      let timer: ReturnType<typeof setTimeout> | undefined;
      const stalled = new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new ProviderStallError(budget, received)),
          budget,
        );
        // Never hold the process open on this timer.
        timer.unref?.();
      });

      let step: IteratorResult<T>;
      try {
        step = await Promise.race([iterator.next(), stalled]);
      } catch (err) {
        if (err instanceof ProviderStallError) opts.onStall?.(err);
        throw err;
      } finally {
        clearTimeout(timer);
      }

      if (step.done) return;
      received++;
      yield step.value;
    }
  } finally {
    // Deliberately not awaited. `return()` on an async generator parked inside
    // an `await` does not settle until that await does — so awaiting the close
    // of a provider that has gone silent would hang here forever, which is
    // precisely the failure this guard exists to prevent.
    void Promise.resolve(iterator.return?.(undefined)).catch(() => {});
  }
}

/**
 * An AbortController that also fires when `parent` does.
 *
 * `AbortSignal.any` would do this in one line but landed in Node 20 and this
 * package still declares `node >=18`.
 */
export function linkAbort(parent?: AbortSignal): AbortController {
  const controller = new AbortController();
  if (!parent) return controller;
  if (parent.aborted) {
    controller.abort(parent.reason);
    return controller;
  }
  parent.addEventListener("abort", () => controller.abort(parent.reason), {
    once: true,
  });
  return controller;
}
