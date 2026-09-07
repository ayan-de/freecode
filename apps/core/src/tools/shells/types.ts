// =============================================================================
// Background shell types — shared by the registry, the tools, and the IPC layer.
// =============================================================================

export type ShellStatus = "running" | "completed" | "failed" | "killed";

/** What the TUI's shells panel and `shells.list` render. No output payload. */
export interface ShellSummary {
  id: string;
  command: string;
  cwd: string;
  status: ShellStatus;
  exitCode: number | null;
  startedAt: number;
  endedAt?: number;
  /** Characters still held in the ring buffer — not the total ever produced. */
  bufferedChars: number;
  /** True once the ring buffer has dropped anything off the front. */
  truncated: boolean;
}

export interface ShellReadResult {
  found: boolean;
  /** Output since the caller's cursor (or since the start for a fresh reader). */
  text: string;
  status: ShellStatus;
  exitCode: number | null;
  /** Characters the ring buffer discarded before this reader could see them. */
  droppedChars: number;
  /** Cursor to pass to the next positional read. */
  nextCursor: number;
}
