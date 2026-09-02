// =============================================================================
// Cost report - renders the `/cost` breakdown from stored daily usage.
// Pure formatting: the numbers come from core via `usage.get`.
// =============================================================================

import type { DailyUsage } from "../ipc/client.js";
import {
  cacheHitRate,
  formatTokenCount,
  type UsageTotals,
} from "./format-tokens.js";

const ZERO: UsageTotals = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
};

/** YYYY-MM-DD in local time, matching how core buckets a day. */
export function localDay(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Sum the breakdown across entries.
 *
 * Entries recorded before the breakdown existed carry a real `tokencount` but
 * no parts. They are skipped rather than counted as zero — folding them in
 * would drag every rate toward 0% and make an old install look broken. The
 * caller reports how many were skipped instead.
 */
export function sumUsage(entries: DailyUsage[]): {
  totals: UsageTotals;
  withBreakdown: number;
  withoutBreakdown: number;
} {
  const totals = { ...ZERO };
  let withBreakdown = 0;
  let withoutBreakdown = 0;

  for (const e of entries) {
    if (e.inputTokens === undefined && e.cacheReadTokens === undefined) {
      if (e.tokencount > 0) withoutBreakdown++;
      continue;
    }
    withBreakdown++;
    totals.inputTokens += e.inputTokens ?? 0;
    totals.outputTokens += e.outputTokens ?? 0;
    totals.cacheReadTokens += e.cacheReadTokens ?? 0;
    totals.cacheWriteTokens += e.cacheWriteTokens ?? 0;
  }

  return { totals, withBreakdown, withoutBreakdown };
}

/** Entries dated within the last `days` days, inclusive of today. */
export function lastNDays(entries: DailyUsage[], days: number): DailyUsage[] {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - (days - 1));
  const cutoffDay = localDay(cutoff);
  return entries.filter((e) => e.date >= cutoffDay);
}

const CACHE_NOTE =
  "Cache reads bill at roughly a tenth of fresh input, so a high rate is a cheap session. Writes bill at ~1.25x — a rate bought by constant rewriting is not a win.";

function row(label: string, totals: UsageTotals): string | undefined {
  const rate = cacheHitRate(totals.inputTokens, totals.cacheReadTokens);
  if (rate === undefined) return undefined;
  const parts = [
    `${formatTokenCount(totals.cacheReadTokens)} read`,
    `${formatTokenCount(totals.cacheWriteTokens)} write`,
    `${formatTokenCount(totals.inputTokens)} in`,
    `${formatTokenCount(totals.outputTokens)} out`,
  ];
  return `${label.padEnd(12)} cache ${String(rate).padStart(3)}%   ${parts.join(" · ")}`;
}

/**
 * The `/cost` body. `session` is the live run-so-far, which is not in the
 * stored data yet for the current turn — it is the number worth acting on, so
 * it leads.
 */
export function renderCostReport(
  entries: DailyUsage[],
  session?: UsageTotals,
): string {
  const today = entries.filter((e) => e.date === localDay());
  const all = sumUsage(entries);

  const rows = [
    session ? row("Session", session) : undefined,
    row("Today", sumUsage(today).totals),
    row("Last 7 days", sumUsage(lastNDays(entries, 7)).totals),
    row("All time", all.totals),
  ].filter((r): r is string => r !== undefined);

  if (rows.length === 0) {
    return "**Token usage**\n\nNo usage recorded yet.";
  }

  const lines = ["**Token usage**", "", "```", ...rows, "```"];

  const notes: string[] = [];
  if (all.withBreakdown > 0) {
    notes.push(
      `${all.withBreakdown} day${all.withBreakdown === 1 ? "" : "s"} recorded`,
    );
  }
  if (all.withoutBreakdown > 0) {
    notes.push(
      `${all.withoutBreakdown} older day${all.withoutBreakdown === 1 ? "" : "s"} without a breakdown (excluded)`,
    );
  }
  if (notes.length > 0) lines.push("", `*${notes.join(" · ")}*`);

  lines.push("", `*${CACHE_NOTE}*`);

  return lines.join("\n");
}

/** Plain-text lines for the `/cost` modal — same data as {@link renderCostReport}, no markdown. */
export function renderCostReportLines(
  entries: DailyUsage[],
  session: UsageTotals | undefined,
  width: number,
): string[] {
  const today = entries.filter((e) => e.date === localDay());
  const all = sumUsage(entries);

  const rows = [
    session ? row("Session", session) : undefined,
    row("Today", sumUsage(today).totals),
    row("Last 7 days", sumUsage(lastNDays(entries, 7)).totals),
    row("All time", all.totals),
  ].filter((r): r is string => r !== undefined);

  if (rows.length === 0) return ["No usage recorded yet."];

  const wrap = (text: string): string[] => {
    if (text.length <= width) return [text];
    const out: string[] = [];
    for (let i = 0; i < text.length; i += width) out.push(text.slice(i, i + width));
    return out;
  };

  const lines: string[] = [...rows];

  const notes: string[] = [];
  if (all.withBreakdown > 0) {
    notes.push(
      `${all.withBreakdown} day${all.withBreakdown === 1 ? "" : "s"} recorded`,
    );
  }
  if (all.withoutBreakdown > 0) {
    notes.push(
      `${all.withoutBreakdown} older day${all.withoutBreakdown === 1 ? "" : "s"} without a breakdown (excluded)`,
    );
  }
  if (notes.length > 0) lines.push("", ...wrap(notes.join(" · ")));

  lines.push(
    "",
    ...wrap(CACHE_NOTE),
  );

  return lines;
}
