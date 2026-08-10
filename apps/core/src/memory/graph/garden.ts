// =============================================================================
// Memory garden — consolidation PROPOSALS over the memory store. Never writes.
// Spec: docs/superpowers/specs/2026-08-10-autonomous-runs-design.md §4.6
// (the one piece of that spec pulled forward ahead of autonomous runs, because
// it is small, safe, and useful attended — a human can run `freecode memory
// graph garden` today with no autonomy involved at all).
//
// Every function here is pure over MemoryEntry[]: no I/O, no embedder, no
// service. That is deliberate, not a simplification of something better —
// "propose, never write" is the whole safety property, and a pure function
// cannot violate it by accident. Applying a proposal stays a human action
// (or, later, an explicitly-gated step at the end of an autonomous run).
//
// Similarity ceiling: duplicate detection uses lexicalSimilarity (Jaccard over
// tokens), not embeddings. It only ever catches near-identical *wording*, so
// two memories saying the same thing in different words will not pair. The
// upgrade path is scoring against the existing vector store instead — worth
// doing once there is real usage data showing the lexical pass misses things
// that matter, and not before, since the embedder is an optional dependency
// and this must work without it.
// =============================================================================

import type { MemoryEntry } from "../mem-types.js";
import { lexicalSimilarity } from "./index.js";

const DEFAULT_DUPLICATE_THRESHOLD = 0.95;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface DuplicatePair {
  /** The one to keep: more recently updated, longer content as the tiebreak. */
  keep: MemoryEntry;
  /** The one proposed for removal. Never removed here — only proposed. */
  drop: MemoryEntry;
  similarity: number;
}

export interface GardenResult {
  duplicates: DuplicatePair[];
  stale: MemoryEntry[];
}

// The name is deliberately excluded: it is the store's file key, so two
// duplicates always differ by it, and including it drags an otherwise-identical
// pair below the threshold. (Found by running the CLI against a seeded store
// with two byte-identical memories and getting "duplicates: none".)
function textOf(entry: MemoryEntry): string {
  return `${entry.description}\n${entry.content}`;
}

/** Stable identity for a pair, so a memory is only proposed for removal once. */
function idOf(entry: MemoryEntry): string {
  return `${entry.type}/${entry.name}`;
}

/**
 * Which of two near-identical memories to keep: the more recently updated,
 * falling back to the longer content, then to the name so the result is
 * deterministic regardless of input order.
 */
function preferred(a: MemoryEntry, b: MemoryEntry): [MemoryEntry, MemoryEntry] {
  if (a.updatedAt !== b.updatedAt) {
    return a.updatedAt > b.updatedAt ? [a, b] : [b, a];
  }
  if (a.content.length !== b.content.length) {
    return a.content.length > b.content.length ? [a, b] : [b, a];
  }
  return a.name <= b.name ? [a, b] : [b, a];
}

/**
 * Near-identical memories, at or above `threshold` lexical similarity.
 *
 * O(n²) over the store. Fine at the sizes a memory store actually reaches
 * (hundreds), and this runs on demand rather than on the hot path; if a store
 * ever gets big enough for it to hurt, block by `type` first — entries of
 * different types are never proposed as duplicates of each other anyway.
 */
export function findDuplicates(
  entries: MemoryEntry[],
  threshold: number = DEFAULT_DUPLICATE_THRESHOLD,
): DuplicatePair[] {
  const sorted = [...entries].sort((a, b) => idOf(a).localeCompare(idOf(b)));
  const dropped = new Set<string>();
  const pairs: DuplicatePair[] = [];

  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      const a = sorted[i];
      const b = sorted[j];
      // Cross-type pairs are not duplicates: the same sentence filed under
      // `user` and under `project` says two different things about who it
      // describes, and merging them would lose that.
      if (a.type !== b.type) continue;
      if (dropped.has(idOf(a)) || dropped.has(idOf(b))) continue;

      const similarity = lexicalSimilarity(textOf(a), textOf(b));
      if (similarity < threshold) continue;

      const [keep, drop] = preferred(a, b);
      dropped.add(idOf(drop));
      pairs.push({ keep, drop, similarity });
    }
  }
  return pairs;
}

/**
 * Memories untouched for longer than `halfLifeDays`, oldest first.
 *
 * "Half-life" is the honest name for what this is: an age threshold, not a
 * decay model. There is no access-frequency signal in the store to decay
 * against — `updatedAt` is the only timestamp a memory carries — so anything
 * fancier here would be arithmetic dressed up as evidence. A stale memory is
 * a *candidate for a human to look at*, not a wrong one: an old memory can be
 * perfectly true, which is exactly why nothing here deletes.
 */
export function findStale(
  entries: MemoryEntry[],
  halfLifeDays: number,
  now: number = Date.now(),
): MemoryEntry[] {
  const cutoff = now - halfLifeDays * MS_PER_DAY;
  return entries
    .filter((e) => e.updatedAt < cutoff)
    .sort((a, b) => a.updatedAt - b.updatedAt);
}

export interface GardenOptions {
  duplicateThreshold?: number;
  halfLifeDays?: number;
  now?: number;
}

/** Default staleness horizon: a memory nothing has touched in three months. */
export const DEFAULT_HALF_LIFE_DAYS = 90;

/**
 * The whole consolidation pass: what a human (or, later, a reviewed autonomous
 * step) might want to merge or prune. Returns proposals and writes nothing.
 * A memory already proposed for removal as a duplicate is not also reported as
 * stale — one recommendation per memory, or the output stops being a worklist.
 */
export function garden(
  entries: MemoryEntry[],
  options: GardenOptions = {},
): GardenResult {
  const duplicates = findDuplicates(entries, options.duplicateThreshold);
  const droppedIds = new Set(duplicates.map((p) => idOf(p.drop)));
  const stale = findStale(
    entries,
    options.halfLifeDays ?? DEFAULT_HALF_LIFE_DAYS,
    options.now,
  ).filter((e) => !droppedIds.has(idOf(e)));
  return { duplicates, stale };
}
