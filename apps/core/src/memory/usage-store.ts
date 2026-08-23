// =============================================================================
// Memory usage counters (spec D12).
//
// Two questions this answers that nothing else in the system can:
//   - which memories are worth keeping (D9's candidate selection)
//   - which episodes have earned their slot despite their age (D6's decay)
//
// `injectedCount` is what makes the other two readable: `useCount` alone cannot
// tell "never useful" from "never shown", and useCount/injectedCount is a
// per-memory precision estimate — the closest thing to ground truth this system
// gets for free.
//
// Lives in `.graph/usage.json`, not in the memory files' frontmatter. Writing a
// counter into a memory would bump its `updatedAt`, dirty the git baseline (D13)
// on every turn, and change the content hash that gates re-embedding — three
// kinds of churn for a number. It follows the sidecar rule: delete it and
// nothing breaks, retention just falls back to age.
// =============================================================================

import * as fs from "fs";
import * as path from "path";
import { logger } from "../utils/logger.js";

const USAGE_FILE = "usage.json";
// Counters are updated per turn but read only by consolidation and retrieval
// scoring, so a lost second of writes costs nothing. Batching keeps this off
// the hot path.
const FLUSH_DEBOUNCE_MS = 2_000;

export interface MemoryUsage {
  useCount: number;
  lastUsedAt: number;
  injectedCount: number;
}

const ZERO: MemoryUsage = { useCount: 0, lastUsedAt: 0, injectedCount: 0 };

interface UsageFile {
  version: 1;
  entries: Record<string, MemoryUsage>;
}

export class UsageStore {
  private file: string;
  private entries = new Map<string, MemoryUsage>();
  private timer: NodeJS.Timeout | null = null;
  private dirty = false;

  constructor(graphDir: string) {
    this.file = path.join(graphDir, USAGE_FILE);
    this.load();
  }

  // A missing, truncated, or schema-mismatched file reads as all-zero. Usage is
  // evidence, not truth: losing it degrades ranking, it never corrupts a store.
  private load(): void {
    try {
      const parsed = JSON.parse(
        fs.readFileSync(this.file, "utf-8"),
      ) as UsageFile;
      if (parsed.version !== 1 || typeof parsed.entries !== "object") return;
      for (const [id, u] of Object.entries(parsed.entries)) {
        if (
          typeof u?.useCount === "number" &&
          typeof u?.lastUsedAt === "number" &&
          typeof u?.injectedCount === "number"
        ) {
          this.entries.set(id, u);
        }
      }
    } catch {
      // Absent or unreadable → start empty.
    }
  }

  get(id: string): MemoryUsage {
    return this.entries.get(id) ?? ZERO;
  }

  all(): Map<string, MemoryUsage> {
    return new Map(this.entries);
  }

  private bump(id: string, fn: (u: MemoryUsage) => MemoryUsage): void {
    this.entries.set(id, fn(this.entries.get(id) ?? { ...ZERO }));
    this.dirty = true;
    this.schedule();
  }

  /** Record that these memories were surfaced to the model this turn. */
  recordInjected(ids: string[]): void {
    for (const id of ids) {
      this.bump(id, (u) => ({ ...u, injectedCount: u.injectedCount + 1 }));
    }
  }

  /** Record that the model said these memories shaped its answer. */
  recordCited(ids: string[], now = Date.now()): void {
    for (const id of ids) {
      this.bump(id, (u) => ({
        ...u,
        useCount: u.useCount + 1,
        lastUsedAt: now,
      }));
    }
  }

  /** Forget a deleted memory's counters so the file cannot grow forever. */
  forget(ids: string[]): void {
    let changed = false;
    for (const id of ids) changed = this.entries.delete(id) || changed;
    if (changed) {
      this.dirty = true;
      this.schedule();
    }
  }

  private schedule(): void {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flush();
    }, FLUSH_DEBOUNCE_MS);
    // Never hold the process open for a counter file.
    this.timer.unref?.();
  }

  /** Write immediately. Called on dispose and by tests; otherwise debounced. */
  flush(): void {
    if (!this.dirty) return;
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const body: UsageFile = {
        version: 1,
        entries: Object.fromEntries(this.entries),
      };
      // Atomic: a half-written counter file on a crash would read as corrupt
      // and silently reset every memory's history.
      const tmp = `${this.file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(body));
      fs.renameSync(tmp, this.file);
      this.dirty = false;
    } catch (error) {
      logger.debug("[MemoryUsage] flush failed", { error });
    }
  }

  dispose(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.flush();
  }
}
