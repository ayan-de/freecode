// =============================================================================
// Daily Token Usage Tracker
// PRIMARY: Accumulate per-day token totals to ~/.freecode/usage.json
// CONSUMER: TUI `/usage` command renders this file as a heatmap
// Best-effort: never throws into the agent loop.
// =============================================================================

import fs from "fs";
import path from "path";
import os from "os";
import { safe } from "../providers/provider-shared.js";

const USAGE_FILE = path.join(os.homedir(), ".freecode", "usage.json");

export interface DailyUsageEntry {
  date: string; // YYYY-MM-DD (local time)
  tokencount: number;
  // Breakdown behind `tokencount`, so the cache hit rate can be read
  // historically rather than only for the run in front of you. Optional
  // because entries written before this existed have only the total.
  //
  // `inputTokens` is the INCLUSIVE prompt total (cache writes already
  // folded in by the provider/AI SDK). `cacheWriteTokens` is the same
  // writes broken out for the cache hit-rate display, NOT an extra addend:
  //   tokencount = inputTokens + outputTokens + reasoningTokens(?)
  // but the heavy hitter is `inputTokens + outputTokens` since `reasoning`
  // is a subset of `outputTokens` for the providers that report it.
  // The invariant on each provider's payload is:
  //   inputTokens === nonCachedInputTokens + cacheReadInputTokens
  //                 + cacheWriteInputTokens
  // which is what the upstream mapper (provider-shared.ts) guarantees.
  inputTokens?: number;
  outputTokens?: number;
  /** Pure visible output (output minus reasoning), when reasoning is reported. */
  outputVisibleTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  /** Reasoning tokens, when the provider reports them (OpenAI Responses, Gemini). */
  reasoningTokens?: number;
}

/**
 * One turn's provider-reported usage, as handed to `recordDailyUsage`. Every
 * field is independently meaningful and additive — downstream code never
 * subtracts. Mirrors `ExecuteUsage` but with the legacy `cacheWriteTokens`
 * name (`cacheCreationInputTokens` on the wire) preserved for clarity here.
 */
export interface UsageBreakdown {
  /**
   * INCLUSIVE prompt total — cache writes already folded in. This is what
   * the provider actually billed as input and is what the user expects to
   * see. Do NOT add `cacheWriteTokens` again on top of this.
   */
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  /** Subset of `outputTokens` spent on hidden reasoning. */
  reasoningTokens?: number;
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
      ...(e.outputVisibleTokens !== undefined && {
        outputVisibleTokens: Number(e.outputVisibleTokens),
      }),
      ...(e.cacheReadTokens !== undefined && {
        cacheReadTokens: Number(e.cacheReadTokens),
      }),
      ...(e.cacheWriteTokens !== undefined && {
        cacheWriteTokens: Number(e.cacheWriteTokens),
      }),
      ...(e.reasoningTokens !== undefined && {
        reasoningTokens: Number(e.reasoningTokens),
      }),
    }));
  } catch {
    return [];
  }
}

// Add one turn's usage to today's bucket (creating it if absent) and persist.
export function recordDailyUsage(usage: UsageBreakdown): void {
  // `inputTokens` is already the inclusive total (cache writes included).
  // The previous version of this file added `cacheWriteTokens` on top of
  // `inputTokens` "to be safe" — but that double-counted on the Anthropic
  // path, where the AI SDK already includes cache writes in `inputTokens`.
  // The provider-shared.ts mapper now guarantees the invariant
  //   inputTokens === nonCachedInputTokens + cacheReadInputTokens
  //                   + cacheWriteInputTokens
  // so we trust the value and use `cacheWriteTokens` only for the breakdown
  // column, never as an additive to the total.
  const inputTokens = safe(usage.inputTokens);
  const outputTokens = safe(usage.outputTokens);
  const cacheReadTokens = safe(usage.cacheReadTokens);
  const cacheWriteTokens = safe(usage.cacheWriteTokens);
  const reasoningTokens = safe(usage.reasoningTokens);
  const outputVisibleTokens = Math.max(0, outputTokens - reasoningTokens);
  const total = inputTokens + outputTokens;
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
    existing.outputVisibleTokens =
      (existing.outputVisibleTokens ?? 0) + outputVisibleTokens;
    existing.cacheReadTokens =
      (existing.cacheReadTokens ?? 0) + cacheReadTokens;
    existing.cacheWriteTokens =
      (existing.cacheWriteTokens ?? 0) + cacheWriteTokens;
    existing.reasoningTokens =
      (existing.reasoningTokens ?? 0) + reasoningTokens;
    fs.writeFileSync(USAGE_FILE, JSON.stringify(entries, null, 2));
  } catch {
    // Usage tracking is best-effort; never break the agent loop.
  }
}
