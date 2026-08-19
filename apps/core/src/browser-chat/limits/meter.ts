// =============================================================================
// Browser Chat — thread meter
//
// Character-based and approximate BY CONSTRUCTION: we cannot see the site's
// tokenizer, and the site never tells us how full its context is. So the meter
// is a predictor, not an oracle — "we guessed wrong and hit the wall" is a
// normal path that rollover recovers from, not an error (spec, Problem 3).
// =============================================================================

export class ThreadMeter {
  private sent = 0;
  private received = 0;
  private turns = 0;

  noteSent(text: string): void {
    this.sent += text.length;
    this.turns++;
  }

  noteReceived(text: string): void {
    this.received += text.length;
  }

  /** Everything this thread has carried, both directions. */
  get totalChars(): number {
    return this.sent + this.received;
  }

  get sentChars(): number {
    return this.sent;
  }

  get turnCount(): number {
    return this.turns;
  }

  /**
   * Proactive rollover check. Deliberately conservative: hitting the wall
   * mid-turn costs a wasted round trip AND a rebootstrap, so predicting a
   * little early is cheaper than predicting a little late.
   */
  shouldRollover(budgetChars: number): boolean {
    return this.totalChars >= budgetChars;
  }

  /** 0..1, for progress reporting. Clamped so a blown budget still renders. */
  fillRatio(budgetChars: number): number {
    if (budgetChars <= 0) return 1;
    return Math.min(1, this.totalChars / budgetChars);
  }
}
