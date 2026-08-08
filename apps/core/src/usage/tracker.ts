// =============================================================================
// Daily Token Usage Tracker
// PRIMARY: Accumulate per-day token totals to ~/.freecode/usage.json
// CONSUMER: TUI `/usage` command renders this file as a heatmap
// Best-effort: never throws into the agent loop.
// =============================================================================

import fs from "fs";
import path from "path";
import os from "os";

const USAGE_FILE = path.join(os.homedir(), ".freecode", "usage.json");

export interface DailyUsageEntry {
  date: string; // YYYY-MM-DD (local time)
  tokencount: number;
  // Breakdown behind `tokencount`, so the cache hit rate can be read
  // historically rather than only for the run in front of you. Optional
  // because entries written before this existed have only the total.
  //
  // `inputTokens` is BILLED input — cache writes folded in, matching what the
  // agent loop reports and what cacheHitRate() expects. `cacheWriteTokens` is
  // those same writes broken out for display, NOT an extra addend:
  //   tokencount = inputTokens + outputTokens + cacheReadTokens
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}

/** One turn's provider-reported usage, as handed to `recordDailyUsage`. */
export interface UsageBreakdown {
  /** Fresh input only — this function folds `cacheWriteTokens` in for you. */
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

function todayLocal(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// Read the accumulated per-day totals. Missing/corrupt file reads as empty —
// callers (the `usage.get` IPC handler, `recordDailyUsage`) treat "no data" and
// "unreadable" the same way.
export function readDailyUsage(): DailyUsageEntry[] {
  try {
    const parsed = JSON.parse(fs.readFileSync(USAGE_FILE, "utf-8"));
    if (!Array.isArray(parsed)) return [];
    // Normalize legacy entries that used `count` instead of `tokencount`, and
    // entries written before the breakdown existed (fields stay undefined so
    // callers can tell "no data" from "a real zero").
    return parsed.map((e) => ({
      date: String(e.date),
      tokencount: Number(e.tokencount ?? e.count ?? 0),
      ...(e.inputTokens !== undefined && { inputTokens: Number(e.inputTokens) }),
      ...(e.outputTokens !== undefined && {
        outputTokens: Number(e.outputTokens),
      }),
      ...(e.cacheReadTokens !== undefined && {
        cacheReadTokens: Number(e.cacheReadTokens),
      }),
      ...(e.cacheWriteTokens !== undefined && {
        cacheWriteTokens: Number(e.cacheWriteTokens),
      }),
    }));
  } catch {
    return [];
  }
}

// Add one turn's usage to today's bucket (creating it if absent) and persist.
export function recordDailyUsage(usage: UsageBreakdown): void {
  const round = (n: number) => (Number.isFinite(n) && n > 0 ? Math.round(n) : 0);
  const cacheWriteTokens = round(usage.cacheWriteTokens);
  // Writes are billed input, so they belong inside inputTokens — the same
  // convention the loop and cacheHitRate() use. They are stored separately too,
  // which is why the total below does not add them a second time.
  const inputTokens = round(usage.inputTokens) + cacheWriteTokens;
  const outputTokens = round(usage.outputTokens);
  const cacheReadTokens = round(usage.cacheReadTokens);
  const total = inputTokens + outputTokens + cacheReadTokens;
  if (total <= 0) return;

  try {
    fs.mkdirSync(path.dirname(USAGE_FILE), { recursive: true });
    const entries = readDailyUsage();
    const today = todayLocal();
    let existing = entries.find((e) => e.date === today);
    if (!existing) {
      existing = { date: today, tokencount: 0 };
      entries.push(existing);
    }
    existing.tokencount += total;
    // `?? 0` rather than `+=` on a possibly-undefined field: today's bucket may
    // predate the breakdown, in which case its total is real but its parts are
    // unknown. Starting the parts at 0 undercounts them against the total,
    // which is the honest outcome — the missing tokens cannot be attributed.
    existing.inputTokens = (existing.inputTokens ?? 0) + inputTokens;
    existing.outputTokens = (existing.outputTokens ?? 0) + outputTokens;
    existing.cacheReadTokens = (existing.cacheReadTokens ?? 0) + cacheReadTokens;
    existing.cacheWriteTokens =
      (existing.cacheWriteTokens ?? 0) + cacheWriteTokens;
    fs.writeFileSync(USAGE_FILE, JSON.stringify(entries, null, 2));
  } catch {
    // Usage tracking is best-effort; never break the agent loop.
  }
}
