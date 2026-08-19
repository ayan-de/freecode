// =============================================================================
// Browser Chat — sent-content ledger
//
// The only optimization here whose failure mode is SILENT: telling the model
// "unchanged since turn 7" when it is not, or when the model no longer has
// turn 7, corrupts its world model with no error anywhere. Every rule below
// exists for that reason, and none is a performance knob.
//
// DEVIATION from the design discussion, deliberate and safer: there is no
// mtime pre-check. That was designed for comparing a file on disk, but by the
// time we get here the tool has ALREADY re-read the file, so we compare the
// fresh result payload against what we actually sent. If the hashes match the
// content is identical by construction — mtime resolution, clock skew and
// restore-in-place cannot produce a false "unchanged". We are optimizing
// transmission, not disk I/O.
// =============================================================================

import { createHash } from "crypto";

/**
 * OPT-IN by tool name, never a flag on the tool definition. A new tool is not
 * deduped until someone deliberately adds it here — the fail-safe default.
 * This also excludes every MCP tool automatically: they register at runtime
 * (`registerMcpTool`), and a self-declared purity flag would delegate that
 * trust decision to a third-party server.
 *
 * `grep`/`glob`/`ls` are excluded on purpose: deduping them needs a
 * fingerprint of the whole searched corpus, which costs about as much as
 * re-running the tool, and their payloads are small. The win is concentrated
 * entirely in large `read`s.
 */
const DEDUPABLE_TOOLS = new Set(["read"]);

/**
 * A slice at offset 4000 is a different result from the whole file, so the key
 * carries the range — not just the path.
 */
export function ledgerKey(tool: string, args: unknown): string | null {
  if (!DEDUPABLE_TOOLS.has(tool)) return null;
  if (typeof args !== "object" || args === null) return null;
  const record = args as Record<string, unknown>;
  const path = record.path ?? record.file_path;
  if (typeof path !== "string" || path.length === 0) return null;
  const offset = Number(record.offset ?? 0) || 0;
  const limit = Number(record.limit ?? 0) || 0;
  return `${tool}:${path}:${offset}:${limit}`;
}

function hash(payload: string): string {
  return createHash("sha256").update(payload).digest("hex").slice(0, 16);
}

interface Entry {
  payloadHash: string;
  turn: number;
  charsAtSend: number;
  dedupedOnce: boolean;
}

export type LedgerDecision =
  | { dedupe: false }
  | { dedupe: true; replacement: string };

export class SentLedger {
  private entries = new Map<string, Entry>();

  constructor(private readonly maxAgeChars: number) {}

  get size(): number {
    return this.entries.size;
  }

  /**
   * @param payload what we would send (already truncated — we record what the
   *                model actually receives, not what was read from disk)
   * @param charsNow the thread meter's current total
   */
  consider(
    key: string,
    payload: string,
    charsNow: number,
    turn: number,
  ): LedgerDecision {
    const entry = this.entries.get(key);
    if (!entry) return { dedupe: false };

    // Content differs ⇒ the file changed. Not a dedup candidate at all.
    if (entry.payloadHash !== hash(payload)) return { dedupe: false };

    // Second request for a key we already deduped: the model does not have it.
    // Send it in full, unconditionally. Bounds the worst case at one wasted
    // round trip and needs no guess about an invisible context boundary.
    if (entry.dedupedOnce) return { dedupe: false };

    // Proactive hedge against the site silently truncating early turns before
    // our char meter believes the thread is full.
    if (charsNow - entry.charsAtSend > this.maxAgeChars) return { dedupe: false };

    entry.dedupedOnce = true;
    return {
      dedupe: true,
      replacement: `[unchanged since turn ${entry.turn} — content identical to what you already have above]`,
    };
  }

  /** Record what we are actually putting on the wire. */
  record(key: string, payload: string, charsNow: number, turn: number): void {
    this.entries.set(key, {
      payloadHash: hash(payload),
      turn,
      charsAtSend: charsNow,
      dedupedOnce: false,
    });
  }

  /**
   * HARD INVARIANT: called on every rebootstrap. A new thread contains none of
   * the prior results, so a surviving ledger would be wrong 100% of the time,
   * immediately — not probabilistically. This is the severe version of the
   * context boundary, and the only one we can actually observe.
   */
  clear(): void {
    this.entries.clear();
  }
}
