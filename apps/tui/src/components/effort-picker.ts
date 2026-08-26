import { Key, matchesKey, type Component } from "@earendil-works/pi-tui";
import chalk from "chalk";
import type { EffortLevel } from "@thisisayande/freecode-shared";

export const EFFORT_LEVELS: EffortLevel[] = [
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];

/**
 * EffortPicker — a "Faster ↔ Smarter" slider over EFFORT_LEVELS, ←/→ to move,
 * Enter to confirm, Esc to cancel. Mirrors Claude Code's /effort modal.
 */
export class EffortPicker implements Component {
  private index: number;

  onSelect?: (level: EffortLevel) => void;
  onCancel?: () => void;

  constructor(current: EffortLevel | undefined) {
    const i = current ? EFFORT_LEVELS.indexOf(current) : 0;
    this.index = i === -1 ? 0 : i;
  }

  handleInput(data: string): void {
    // matchesKey (not raw string compare) so this also recognizes Kitty
    // protocol-encoded sequences — a plain "\x1b" check missed those, which
    // is why Esc wasn't closing the modal.
    if (matchesKey(data, Key.escape)) {
      this.onCancel?.();
      return;
    }
    if (matchesKey(data, Key.left) || data === "\x1b[D" || data === "\x1bOD") {
      this.index = Math.max(0, this.index - 1);
      return;
    }
    if (matchesKey(data, Key.right) || data === "\x1b[C" || data === "\x1bOC") {
      this.index = Math.min(EFFORT_LEVELS.length - 1, this.index + 1);
      return;
    }
    if (matchesKey(data, Key.enter) || data === "\r" || data === "\n") {
      this.onSelect?.(EFFORT_LEVELS[this.index]);
    }
  }

  invalidate(): void {}

  render(width: number): string[] {
    // Never exceed what the container actually gave us — inflating past
    // `width` here just gets silently truncated by the modal's row-clipping,
    // which is what was cutting "Smarter"/"max" off the right edge. The `- 2`
    // accounts for the leading indent every line below adds.
    const w = Math.max(1, width - 2);
    const slots = EFFORT_LEVELS.length;
    const centerOf = (i: number) => Math.round((i + 0.5) * (w / slots));

    const header =
      chalk.dim("Faster") +
      " ".repeat(Math.max(1, w - "Faster".length - "Smarter".length)) +
      chalk.dim("Smarter");

    const trackChars = Array<string>(w).fill("─");
    trackChars[Math.min(w - 1, centerOf(this.index))] = "▲";
    const track = trackChars
      .map((ch, i) => (i === centerOf(this.index) ? chalk.yellow(ch) : chalk.dim(ch)))
      .join("");

    const chars = Array<string>(w).fill(" ");
    for (let i = 0; i < slots; i++) {
      const label = EFFORT_LEVELS[i];
      const pos = Math.max(
        0,
        Math.min(w - label.length, centerOf(i) - Math.floor(label.length / 2)),
      );
      for (let j = 0; j < label.length; j++) chars[pos + j] = label[j];
    }
    // Style whole runs of non-space chars at once — styling char-by-char and
    // concatenating breaks chalk's reset codes across the join.
    let styledLabelLine = "";
    let run = "";
    let runSelected = false;
    const flush = () => {
      if (!run) return;
      styledLabelLine += runSelected
        ? chalk.yellowBright.bold(run)
        : chalk.dim(run);
      run = "";
    };
    for (let pos = 0; pos < w; pos++) {
      const levelIdx = EFFORT_LEVELS.findIndex((label, i) => {
        const start = Math.max(
          0,
          Math.min(w - label.length, centerOf(i) - Math.floor(label.length / 2)),
        );
        return pos >= start && pos < start + label.length;
      });
      if (chars[pos] === " ") {
        flush();
        styledLabelLine += " ";
      } else {
        const selected = levelIdx === this.index;
        if (run && selected !== runSelected) flush();
        runSelected = selected;
        run += chars[pos];
      }
    }
    flush();

    return [
      "",
      `  ${header}`,
      `  ${track}`,
      `  ${styledLabelLine}`,
      `  ${chalk.dim("←/→ to change, Enter to confirm, Esc to cancel")}`,
    ];
  }
}
