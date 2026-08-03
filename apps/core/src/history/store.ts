// =============================================================================
// Prompt History
// PRIMARY: Persist submitted prompts to ~/.freecode/history.jsonl so up-arrow
// navigation works across sessions (the in-memory editor ring is reset on
// restart). JSONL — one entry per line — keeps writes append-only and tolerant
// of partial corruption, the same trade-off Claude Code makes.
//
// CONSUMER: TUI's PromptEditor seeds its in-memory history at startup and
// appends on every submit.
//
// Best-effort: never throws into the agent loop. A missing or unreadable file
// reads as an empty list, the same as a never-used TUI.
// =============================================================================

import fs from "fs";
import os from "os";
import path from "path";

/** Maximum prompts to retain — matches pi-tui's in-memory cap of 100. */
export const MAX_HISTORY_ITEMS = 100;

export interface HistoryEntry {
  /** The prompt text the user submitted. */
  display: string;
  /** Wall-clock timestamp (ms since epoch). */
  timestamp: number;
}

/**
 * Resolve the history file path on every call — not at module load time — so
 * `process.env.HOME` overrides in tests point the store at the right place.
 */
function historyFilePath(): string {
  return path.join(os.homedir(), ".freecode", "history.jsonl");
}

/**
 * Read the entire history file, newest entry first. Lines that fail to parse
 * (partial writes, manual edits) are skipped rather than aborting the load.
 */
export function readHistory(): HistoryEntry[] {
  try {
    const content = fs.readFileSync(historyFilePath(), "utf-8");
    const out: HistoryEntry[] = [];
    // Files in tail order — lines are appended newest-last, so iterate
    // bottom-up to deliver newest-first without reversing the whole array.
    const lines = content.split("\n");
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i];
      if (!line) continue;
      try {
        const entry = JSON.parse(line) as HistoryEntry;
        if (typeof entry?.display === "string") {
          out.push(entry);
        }
      } catch {
        // Skip malformed lines silently — one bad row should never block
        // history from loading.
      }
    }
    return out;
  } catch {
    return [];
  }
}

/** Just the prompt strings, newest-first, for the editor's `addToHistory` ring. */
export function readHistoryDisplays(): string[] {
  return readHistory().map((e) => e.display);
}

/**
 * Append a prompt to history. Dedupes against the most-recent entry and
 * caps the file at MAX_HISTORY_ITEMS by trimming the oldest lines. The
 * disk file is rewritten (not appended past the cap) so the file size
 * stays bounded.
 */
export function appendHistory(display: string): void {
  const trimmed = display.trim();
  if (!trimmed) return;

  try {
    const file = historyFilePath();
    fs.mkdirSync(path.dirname(file), { recursive: true });

    const existing = readHistory();
    // Dedup against the most recent entry only — same rule pi-tui uses
    // for its in-memory ring.
    if (existing[0]?.display === trimmed) return;

    // `existing` is already newest-first. The serialized file is written
    // oldest-first so the newest entry is at the tail — the reader then
    // walks bottom-up to deliver newest-first without reversing the array.
    const next: HistoryEntry[] = [
      { display: trimmed, timestamp: Date.now() },
      ...existing,
    ];
    if (next.length > MAX_HISTORY_ITEMS) next.length = MAX_HISTORY_ITEMS;
    const oldestFirst = [...next].reverse();

    const serialized = oldestFirst
      .map((e) => JSON.stringify(e))
      .join("\n") + "\n";
    fs.writeFileSync(file, serialized, "utf-8");
  } catch {
    // History is best-effort — don't break the agent loop on disk failure.
  }
}

/** Path to the underlying file — exposed for tests and CLI tooling. */
export function getHistoryFilePath(): string {
  return historyFilePath();
}