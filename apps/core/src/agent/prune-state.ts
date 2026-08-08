// =============================================================================
// PruneState — per-session record of which tool results have been shown to the
// provider, and how, so the prompt prefix stays byte-stable across turns.
//
// Prompt caching matches on an exact prefix. Any byte that changes in an
// already-sent message invalidates the cache from that point on, and everything
// after it is re-billed as a cache write (1.25x) rather than a read (0.1x).
//
// The previous pruning used a sliding "keep the last N turns at full size"
// window, which guarantees that breakage: a result sent whole on turn N was
// sent truncated on turn N+1, mutating the prefix two turns back on every
// single turn. Recording the decision instead of re-deriving it is what makes
// the difference (spec 2026-08-05-token-efficiency, RC4).
//
// Mirrors claude-code's partitionByPriorDecision / ContentReplacementState
// (utils/toolResultStorage.ts:648).
// =============================================================================

export interface PruneCandidate {
  /** Stable within a session — see the id derivation in loop.ts loadHistory. */
  id: string;
  /** Current model-visible size, in chars. */
  size: number;
}

export interface PrunePartition<T extends PruneCandidate> {
  /** Already replaced once; re-apply the stored text verbatim. */
  mustReapply: Array<T & { replacement: string }>;
  /** Already sent unreplaced; off-limits, it is in the cached prefix. */
  frozen: T[];
  /** Never sent; eligible for a replacement decision this turn. */
  fresh: T[];
}

export class PruneState {
  /** toolCallId → the exact replacement string previously sent. */
  private readonly replaced = new Map<string, string>();
  /** toolCallId sent to the provider at full size. */
  private readonly seen = new Set<string>();

  /**
   * Split candidates by what was already sent for them.
   *
   * `frozen` is the load-bearing case. A result left at full size is in the
   * provider's cached prefix; shrinking it now to save ~250 tokens costs a
   * partial cache invalidation, which is far more expensive. Once shown, a
   * result stays shown — compaction, not pruning, is what eventually removes it.
   */
  partition<T extends PruneCandidate>(
    candidates: readonly T[],
  ): PrunePartition<T> {
    const partition: PrunePartition<T> = {
      mustReapply: [],
      frozen: [],
      fresh: [],
    };
    for (const candidate of candidates) {
      const replacement = this.replaced.get(candidate.id);
      if (replacement !== undefined) {
        partition.mustReapply.push({ ...candidate, replacement });
      } else if (this.seen.has(candidate.id)) {
        partition.frozen.push(candidate);
      } else {
        partition.fresh.push(candidate);
      }
    }
    return partition;
  }

  /**
   * Pick the largest fresh results to replace until the model-visible total is
   * under budget, or fresh is exhausted.
   *
   * `frozenSize` is counted but not reducible. If it alone exceeds the budget
   * the overage is accepted rather than breaking the prefix to fix it —
   * compaction handles that case.
   */
  static selectFreshToReplace<T extends PruneCandidate>(
    fresh: readonly T[],
    frozenSize: number,
    budget: number,
  ): T[] {
    const selected: T[] = [];
    let remaining =
      frozenSize + fresh.reduce((sum, candidate) => sum + candidate.size, 0);
    if (remaining <= budget) return selected;

    // Largest first: fewest replacements for the most saving.
    for (const candidate of [...fresh].sort((a, b) => b.size - a.size)) {
      if (remaining <= budget) break;
      selected.push(candidate);
      // The replacement is a short marker, so treating its size as zero
      // slightly over-selects. Close enough for a selection heuristic.
      remaining -= candidate.size;
    }
    return selected;
  }

  /** Record a replacement so later turns re-apply this exact string. */
  recordReplaced(id: string, replacement: string): void {
    this.replaced.set(id, replacement);
  }

  /**
   * Record that a result went out at full size, freezing it against future
   * replacement. Must be called for every unreplaced candidate on every send —
   * a candidate that is skipped here stays `fresh` and can be replaced on a
   * later turn, which is exactly the prefix mutation this class prevents.
   */
  recordSeen(id: string): void {
    if (!this.replaced.has(id)) this.seen.add(id);
  }

  /** Cleared per run(); ids are only meaningful within one loaded history. */
  reset(): void {
    this.replaced.clear();
    this.seen.clear();
  }
}
