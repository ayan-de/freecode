// =============================================================================
// BM25 over the memory store (spec D1).
//
// Replaces the substring-overlap scorer that shipped in mem-query.ts, which
// awarded +5/+1 per overlapping token pair with no IDF and no length
// normalization — so a term present in every memory counted as much as a rare
// one, and a long memory outscored a precise short one on incidental overlap.
//
// Not a general search engine: a few hundred short documents, scored in-process
// on a path that already tolerates a full store walk. No dependency.
// =============================================================================

import type { MemoryEntry } from "./mem-types.js";

// Standard BM25 parameters. k1 controls term-frequency saturation, b controls
// how hard length normalization bites. These are the literature defaults and
// are not tuned for this corpus (spec §10.5).
const K1 = 1.2;
const B = 0.75;

// Field weights preserve the intent of the old scorer's +5 description / +1
// content split: a term in the description is a stronger signal than the same
// term buried in a body.
const FIELD_WEIGHTS = { name: 3, description: 5, content: 1 } as const;

// A whole-query match against the memory's name is a near-certain hit and is
// worth more than any amount of term overlap. Carried over from the old scorer.
const EXACT_NAME_BONUS = 10;

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2);
}

interface Doc {
  id: string;
  name: string;
  // Weighted term frequencies, already summed across fields.
  tf: Map<string, number>;
  length: number;
}

export class Bm25Index {
  private docs: Doc[] = [];
  private df = new Map<string, number>();
  private avgLength = 0;

  constructor(entries: MemoryEntry[] = [], idOf?: (e: MemoryEntry) => string) {
    if (entries.length > 0) this.build(entries, idOf);
  }

  // Rebuild from the current store contents. Called from the graph service's
  // sync() pass so the index is refreshed off the same entry list as the
  // embeddings — one traversal, one staleness story.
  build(entries: MemoryEntry[], idOf?: (e: MemoryEntry) => string): void {
    const id = idOf ?? ((e: MemoryEntry) => `${e.type}/${e.name}`);
    this.docs = [];
    this.df = new Map();

    for (const entry of entries) {
      const tf = new Map<string, number>();
      let length = 0;
      const add = (text: string, weight: number): void => {
        for (const term of tokenize(text)) {
          tf.set(term, (tf.get(term) ?? 0) + weight);
          length += weight;
        }
      };
      add(entry.name.replace(/[-_]/g, " "), FIELD_WEIGHTS.name);
      add(entry.description, FIELD_WEIGHTS.description);
      add(entry.content, FIELD_WEIGHTS.content);

      for (const term of tf.keys()) {
        this.df.set(term, (this.df.get(term) ?? 0) + 1);
      }
      this.docs.push({ id: id(entry), name: entry.name, tf, length });
    }

    const total = this.docs.reduce((sum, d) => sum + d.length, 0);
    this.avgLength = this.docs.length === 0 ? 0 : total / this.docs.length;
  }

  size(): number {
    return this.docs.length;
  }

  // Robertson/Sparck-Jones IDF with the +0.5 smoothing that keeps it positive
  // for a term appearing in every document (where the raw form goes negative
  // and a universal term would *subtract* from the score).
  private idf(term: string): number {
    const n = this.docs.length;
    const df = this.df.get(term) ?? 0;
    return Math.log(1 + (n - df + 0.5) / (df + 0.5));
  }

  // Score every document against `query`, best first, dropping zero scores.
  search(query: string, limit = 10): { id: string; score: number }[] {
    if (this.docs.length === 0) return [];
    const terms = tokenize(query);
    if (terms.length === 0) return [];

    const lowered = query.toLowerCase().trim();
    const scored: { id: string; score: number }[] = [];

    for (const doc of this.docs) {
      let score = 0;
      for (const term of terms) {
        const freq = doc.tf.get(term);
        if (!freq) continue;
        const norm =
          this.avgLength === 0 ? 1 : 1 - B + B * (doc.length / this.avgLength);
        score += this.idf(term) * ((freq * (K1 + 1)) / (freq + K1 * norm));
      }
      if (lowered.length > 0 && doc.name.toLowerCase().includes(lowered)) {
        score += EXACT_NAME_BONUS;
      }
      if (score > 0) scored.push({ id: doc.id, score });
    }

    scored.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
    return scored.slice(0, limit);
  }
}
