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
}

function todayLocal(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function readUsage(): DailyUsageEntry[] {
  try {
    const parsed = JSON.parse(fs.readFileSync(USAGE_FILE, "utf-8"));
    if (!Array.isArray(parsed)) return [];
    // Normalize legacy entries that used `count` instead of `tokencount`.
    return parsed.map((e) => ({
      date: String(e.date),
      tokencount: Number(e.tokencount ?? e.count ?? 0),
    }));
  } catch {
    return [];
  }
}

// Add `tokens` to today's bucket (creating it if absent) and persist.
export function recordDailyUsage(tokens: number): void {
  if (!Number.isFinite(tokens) || tokens <= 0) return;
  try {
    fs.mkdirSync(path.dirname(USAGE_FILE), { recursive: true });
    const entries = readUsage();
    const today = todayLocal();
    const existing = entries.find((e) => e.date === today);
    if (existing) {
      existing.tokencount += Math.round(tokens);
    } else {
      entries.push({ date: today, tokencount: Math.round(tokens) });
    }
    fs.writeFileSync(USAGE_FILE, JSON.stringify(entries, null, 2));
  } catch {
    // Usage tracking is best-effort; never break the agent loop.
  }
}
