// =============================================================================
// Browser Chat — async handoff queue
//
// The page pushes chunks in (from an exposed binding callback, synchronously);
// the provider pulls them out as an async iterable. Pure and dependency-free
// so it is unit-testable without a browser.
// =============================================================================

type Waiter<T> = (value: IteratorResult<T>) => void;

export class ChunkQueue<T> {
  private items: T[] = [];
  private waiters: Waiter<T>[] = [];
  private closed = false;

  push(item: T): void {
    if (this.closed) return;
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter({ value: item, done: false });
      return;
    }
    this.items.push(item);
  }

  /**
   * Drop anything buffered. Called when a new stream starts: a leftover chunk
   * from a previous response — especially a stale `end` — would terminate the
   * next turn before it produced anything.
   */
  clear(): void {
    this.items = [];
  }

  /** No more items will ever arrive (tab closed, transport disconnected). */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    // Release everyone still parked, or they hang forever.
    for (const waiter of this.waiters) {
      waiter({ value: undefined as never, done: true });
    }
    this.waiters = [];
  }

  get isClosed(): boolean {
    return this.closed;
  }

  get pending(): number {
    return this.items.length;
  }

  private next(): Promise<IteratorResult<T>> {
    const item = this.items.shift();
    if (item !== undefined) {
      return Promise.resolve({ value: item, done: false });
    }
    if (this.closed) {
      return Promise.resolve({ value: undefined as never, done: true });
    }
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  /**
   * Yields until the queue closes. Callers that want a per-turn boundary
   * (stop at an `end` chunk) break out of the loop themselves — the queue
   * stays open across turns because the tab does.
   */
  async *drain(signal?: AbortSignal): AsyncGenerator<T> {
    while (true) {
      if (signal?.aborted) return;
      const result = await this.next();
      if (result.done) return;
      yield result.value;
    }
  }
}
