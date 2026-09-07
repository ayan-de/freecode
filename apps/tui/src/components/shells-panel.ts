import {
  Key,
  matchesKey,
  truncateToWidth,
  visibleWidth,
  type Component,
} from "@earendil-works/pi-tui";
import chalk from "chalk";
import type { ShellSummary } from "@thisisayande/freecode-shared";

// Card chrome matches ScrollableModal so the two read as one family.
const ACCENT = "#FFD700";
const DIM = "#666666";
const PAD_X = 2;
/** Top border, blank, separator, blank, hint, bottom border. */
const CHROME_ROWS = 6;
const MIN_INNER_WIDTH = 32;
/** Rows the shell list may take before it scrolls; the rest is output. */
const MAX_LIST_ROWS = 6;
const MIN_OUTPUT_ROWS = 3;

export interface ShellsPanelCallbacks {
  onKill: (shellId: string) => void;
  /** Drop a settled shell from the roster. Core refuses a running one. */
  onRemove: (shellId: string) => void;
  onClose: () => void;
}

function elapsed(shell: ShellSummary): string {
  const ms = (shell.endedAt ?? Date.now()) - shell.startedAt;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return s % 60 === 0 ? `${m}m` : `${m}m${String(s % 60).padStart(2, "0")}s`;
}

function statusCell(shell: ShellSummary): string {
  switch (shell.status) {
    case "running":
      return chalk.green("● running");
    case "completed":
      return chalk.green(`✔ exit ${shell.exitCode ?? 0}`);
    case "killed":
      return chalk.yellow("■ killed");
    default:
      return chalk.red(`✘ exit ${shell.exitCode ?? "?"}`);
  }
}

/**
 * ShellsPanel — the `/shells` card: every background shell this session
 * started, with a live tail of whichever one is selected.
 *
 * Data is pushed in from index.ts (`setShells` / `appendOutput`) rather than
 * fetched here: the TUI is a presentation layer, and the same stream events
 * that keep the panel current arrive whether or not it happens to be open.
 *
 * Selection drives which buffer is shown, so switching rows is instant — the
 * output for every shell is already held, not re-fetched on each keypress.
 */
export class ShellsPanel implements Component {
  private shells: ShellSummary[] = [];
  private outputs = new Map<string, string[]>();
  private selected = 0;
  private listScroll = 0;
  /** Rows scrolled up from the tail; 0 means "follow the live output". */
  private outputScroll = 0;
  private maxRowsSource: () => number = () => 24;

  constructor(private readonly callbacks: ShellsPanelCallbacks) {}

  setMaxRows(rows: number | (() => number)): void {
    this.maxRowsSource = typeof rows === "function" ? rows : () => rows;
  }

  /** Replaces the roster. Keeps the selection pinned to the same shell id. */
  setShells(shells: ShellSummary[]): void {
    const previousId = this.shells[this.selected]?.id;
    this.shells = shells;
    // Drop buffers for shells core no longer knows about, or removing one
    // would free its record and leak the panel's copy of its output.
    const live = new Set(shells.map((s) => s.id));
    for (const id of this.outputs.keys()) {
      if (!live.has(id)) this.outputs.delete(id);
    }
    const next = shells.findIndex((s) => s.id === previousId);
    this.selected =
      next >= 0 ? next : Math.min(this.selected, shells.length - 1);
    if (this.selected < 0) this.selected = 0;
  }

  /** Seed a shell's buffer wholesale (first open, or after a cursor reset). */
  setOutput(shellId: string, text: string): void {
    this.outputs.set(shellId, text.split("\n"));
  }

  /** Live chunk from a `shell_output` stream event. */
  appendOutput(shellId: string, chunk: string): void {
    const lines = this.outputs.get(shellId) ?? [""];
    const parts = chunk.split("\n");
    lines[lines.length - 1] += parts[0];
    for (const part of parts.slice(1)) lines.push(part);
    // Bound the panel's own copy: a dev server can log for hours and this is a
    // viewport, not the archive — core's ring buffer is the source of truth.
    if (lines.length > 2000) lines.splice(0, lines.length - 2000);
    this.outputs.set(shellId, lines);
  }

  /** Feeds the ModeLine chip, which is why it stays correct while closed. */
  runningCount(): number {
    return this.shells.filter((s) => s.status === "running").length;
  }

  selectedShellId(): string | undefined {
    return this.shells[this.selected]?.id;
  }

  isEmpty(): boolean {
    return this.shells.length === 0;
  }

  private get maxRows(): number {
    return Math.max(CHROME_ROWS + MIN_OUTPUT_ROWS + 1, this.maxRowsSource());
  }

  private innerWidth(width: number): number {
    return Math.max(MIN_INNER_WIDTH, width - 2);
  }

  heightFor(width: number): number {
    void width;
    return this.maxRows;
  }

  render(width: number): string[] {
    const inner = this.innerWidth(width);
    const bodyWidth = inner - PAD_X * 2;
    const accent = (s: string): string => chalk.hex(ACCENT)(s);
    const dim = (s: string): string => chalk.hex(DIM)(s);
    const border = accent("│");

    const row = (text: string): string => {
      const clipped =
        visibleWidth(text) > bodyWidth
          ? truncateToWidth(text, bodyWidth)
          : text;
      const fill = " ".repeat(Math.max(0, bodyWidth - visibleWidth(clipped)));
      const pad = " ".repeat(PAD_X);
      return `${border}${pad}${clipped}${fill}${pad}${border}`;
    };

    // Split the body between the roster and the output. The list yields first
    // when space is tight: heightFor() promises maxRows, and a list that keeps
    // its six rows on a short terminal pushes the card past that promise and
    // corrupts the overlay composite.
    const bodyRows = this.maxRows - CHROME_ROWS;
    const listRows = Math.max(
      1,
      Math.min(MAX_LIST_ROWS, this.shells.length, bodyRows - MIN_OUTPUT_ROWS),
    );
    const outputRows = Math.max(MIN_OUTPUT_ROWS, bodyRows - listRows);

    // Keep the cursor inside the list viewport.
    if (this.selected < this.listScroll) this.listScroll = this.selected;
    if (this.selected >= this.listScroll + listRows) {
      this.listScroll = this.selected - listRows + 1;
    }

    const rows: string[] = [];
    const title = ` Background shells `;
    rows.push(
      accent("╭─") +
        chalk.bold(title) +
        accent("─".repeat(Math.max(0, inner - visibleWidth(title) - 1)) + "╮"),
    );

    if (this.shells.length === 0) {
      rows.push(row(""));
      rows.push(row(dim("No background shells in this session.")));
      rows.push(
        row(dim("The agent starts one with bash(run_in_background: true).")),
      );
      while (rows.length < this.maxRows - 2) rows.push(row(""));
    } else {
      for (const shell of this.shells.slice(
        this.listScroll,
        this.listScroll + listRows,
      )) {
        const isSelected = this.shells[this.selected]?.id === shell.id;
        const marker = isSelected ? accent("▸ ") : "  ";
        const meta = `${statusCell(shell)}  ${dim(elapsed(shell).padStart(6))}`;
        const metaWidth = visibleWidth(meta);
        const cmdWidth = Math.max(8, bodyWidth - metaWidth - 4);
        const cmd = truncateToWidth(shell.command.split("\n")[0], cmdWidth);
        const gap = " ".repeat(
          Math.max(1, bodyWidth - 2 - visibleWidth(cmd) - metaWidth),
        );
        rows.push(
          row(`${marker}${isSelected ? chalk.bold(cmd) : cmd}${gap}${meta}`),
        );
      }

      rows.push(accent("├") + accent("─".repeat(inner)) + accent("┤"));

      const lines = this.outputs.get(this.selectedShellId() ?? "") ?? [];
      const maxScroll = Math.max(0, lines.length - outputRows);
      if (this.outputScroll > maxScroll) this.outputScroll = maxScroll;
      const end = lines.length - this.outputScroll;
      const window = lines.slice(Math.max(0, end - outputRows), end);
      if (window.length === 0) {
        rows.push(row(dim("(no output yet)")));
      }
      for (const line of window) rows.push(row(line));
      while (rows.length < this.maxRows - 2) rows.push(row(""));
    }

    // The hint names the action that applies to the CURRENT selection: k on a
    // running shell, d on a settled one. Showing both always would offer a key
    // that silently does nothing.
    const selected = this.shells[this.selected];
    const action =
      selected?.status === "running" ? "k kill" : selected ? "d dismiss" : "";
    rows.push(
      row(
        dim(
          [
            "↑↓ select",
            "pgup/pgdn scroll",
            ...(this.outputScroll > 0 ? ["end follow"] : []),
            ...(action ? [action] : []),
            "esc close",
          ].join(" · "),
        ),
      ),
    );
    rows.push(accent("╰" + "─".repeat(inner) + "╯"));
    return rows;
  }

  handleInput(data: string): void {
    if (matchesKey(data, Key.escape) || data === "q") {
      this.callbacks.onClose();
      return;
    }
    if (matchesKey(data, Key.up)) {
      this.selected = Math.max(0, this.selected - 1);
      this.outputScroll = 0;
      return;
    }
    if (matchesKey(data, Key.down)) {
      this.selected = Math.min(this.shells.length - 1, this.selected + 1);
      this.outputScroll = 0;
      return;
    }
    if (matchesKey(data, Key.pageUp)) {
      this.outputScroll += MIN_OUTPUT_ROWS;
      return;
    }
    if (matchesKey(data, Key.pageDown)) {
      this.outputScroll = Math.max(0, this.outputScroll - MIN_OUTPUT_ROWS);
      return;
    }
    if (matchesKey(data, Key.end) || data === "G") {
      this.outputScroll = 0;
      return;
    }
    if (data === "k") {
      const id = this.selectedShellId();
      if (id) this.callbacks.onKill(id);
      return;
    }
    if (data === "d") {
      // Only a settled shell: dismissing a running one would leave the process
      // alive with nothing left holding a handle to stop it.
      const shell = this.shells[this.selected];
      if (shell && shell.status !== "running") {
        this.callbacks.onRemove(shell.id);
      }
    }
  }

  invalidate(): void {}
}
