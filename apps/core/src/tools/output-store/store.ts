// =============================================================================
// OutputStore - per-session, in-memory store of FULL tool output.
// The orchestrator caps what the model sees (adaptiveTruncate) but stores the
// whole thing here, keyed by toolCallId, so the model can page through the rest
// via the `output` tool instead of re-running the command (spec D1).
//
// One instance per session (see index.ts). Byte-LRU: when total bytes exceed the
// cap, the oldest outputs are evicted first — a store miss degrades gracefully
// ("re-run the tool", spec D4), it never throws.
// =============================================================================

import { STORE_BYTES } from "./config.js";

function byteLen(text: string): number {
  return Buffer.byteLength(text, "utf8");
}

export interface SliceResult {
  found: boolean;
  text: string;
  totalLines: number;
}

export class OutputStore {
  // Insertion order is the LRU order; get()/put() move an entry to the newest.
  private map = new Map<string, string>();
  private bytes = 0;
  private maxBytes: number;

  constructor(maxBytes: number = STORE_BYTES) {
    this.maxBytes = maxBytes;
  }

  put(id: string, text: string): void {
    const prev = this.map.get(id);
    if (prev !== undefined) {
      this.bytes -= byteLen(prev);
      this.map.delete(id);
    }
    this.map.set(id, text);
    this.bytes += byteLen(text);
    this.evict();
  }

  // Returns the full stored output, or undefined if never stored / evicted.
  get(id: string): string | undefined {
    const v = this.map.get(id);
    if (v !== undefined) {
      this.map.delete(id); // LRU touch: move to newest
      this.map.set(id, v);
    }
    return v;
  }

  has(id: string): boolean {
    return this.map.has(id);
  }

  // Line window [offset, offset+limit). offset is 1-based (matches read.ts).
  slice(id: string, offset = 1, limit = 200): SliceResult {
    const full = this.get(id);
    if (full === undefined) return { found: false, text: "", totalLines: 0 };
    const lines = full.split("\n");
    const start = Math.max(0, offset - 1);
    return {
      found: true,
      text: lines.slice(start, start + limit).join("\n"),
      totalLines: lines.length,
    };
  }

  // Lines matching `pattern` (regex if valid, else literal substring), each
  // prefixed with its 1-based line number. `context` includes ±N surrounding
  // lines per match (grep -C); non-adjacent groups are separated by "--".
  grep(id: string, pattern: string, context = 0): SliceResult {
    const full = this.get(id);
    if (full === undefined) return { found: false, text: "", totalLines: 0 };
    const lines = full.split("\n");
    let test: (line: string) => boolean;
    try {
      const re = new RegExp(pattern);
      test = (line) => re.test(line);
    } catch {
      test = (line) => line.includes(pattern);
    }
    // Collect the set of line indices to emit (match ± context), then walk them
    // in order, inserting a "--" gap marker between non-contiguous runs.
    const keep = new Set<number>();
    for (let i = 0; i < lines.length; i++) {
      if (!test(lines[i])) continue;
      for (let j = Math.max(0, i - context); j <= Math.min(lines.length - 1, i + context); j++) {
        keep.add(j);
      }
    }
    const idx = [...keep].sort((a, b) => a - b);
    const out: string[] = [];
    let prev = -2;
    for (const i of idx) {
      if (context > 0 && i !== prev + 1 && out.length > 0) out.push("--");
      out.push(`${i + 1}: ${lines[i]}`);
      prev = i;
    }
    return { found: true, text: out.join("\n"), totalLines: lines.length };
  }

  private evict(): void {
    // Keep at least the just-added entry even if it alone exceeds the cap.
    while (this.bytes > this.maxBytes && this.map.size > 1) {
      const oldest = this.map.keys().next().value as string;
      this.bytes -= byteLen(this.map.get(oldest)!);
      this.map.delete(oldest);
    }
  }

  dispose(): void {
    this.map.clear();
    this.bytes = 0;
  }

  stats(): { entries: number; bytes: number } {
    return { entries: this.map.size, bytes: this.bytes };
  }
}
