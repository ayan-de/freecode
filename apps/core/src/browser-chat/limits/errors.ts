// =============================================================================
// Browser Chat — typed limit errors
//
// Separated from generic failures because they mean different things to the
// caller: a full thread is recoverable in-place (roll to a new chat), a usage
// limit is not (nothing we do locally makes messages appear).
// =============================================================================

export class ThreadFullError extends Error {
  constructor(public readonly detail: string) {
    super(`browser-chat: conversation is full — ${detail}`);
    this.name = "ThreadFullError";
  }
}

export class RateLimitedError extends Error {
  constructor(
    public readonly detail: string,
    public readonly resetAt?: number,
  ) {
    super(
      `browser-chat: usage limit reached — ${detail}` +
        (resetAt ? ` (resets ${new Date(resetAt).toLocaleTimeString()})` : ""),
    );
    this.name = "RateLimitedError";
  }
}
