import { type Component } from "@earendil-works/pi-tui";
import chalk from "chalk";
import { formatTokenCount } from "../utils/format-tokens.js";

const BAR_WIDTH = 10;
const LABEL = "Context";
// formatTokenCount caps a value at 6 columns ("999.9k", "123.4M"), so the widest
// usage string the box can hold is "999.9k/999.9k" — 13 columns.
const MAX_USAGE_WIDTH = 13;
// Inner width is sized to the widest line rather than to the terminal, so the
// box has no dead space: "Context " + usage = 21 cols. The bar line (BAR_WIDTH
// + 2 brackets + a space + "100%" = 17) always fits inside that.
const INNER_WIDTH = LABEL.length + 1 + MAX_USAGE_WIDTH;
const BOX_OUTER_WIDTH = INNER_WIDTH + 2; // 23 cols, borders included

/**
 * ContextBox — a small bordered overlay containing only the context-window
 * usage widget (tokens/limit + progress bar + percentage).
 *
 * Replaces the right-hand portion of the old fixed `StatusHeader`. Renders as
 * an empty single-row box when the limit is unknown or hasn't been recorded
 * yet, so the box always exists once visible() permits it but doesn't lie
 * about numbers that aren't available.
 *
 * Renders at a fixed width (`width()`) so callers can pass it to the overlay
 * system and have it anchor correctly to the right edge — without an explicit
 * width, pi-tui defaults the overlay width to 80 cols, which would push the
 * box into the middle of a wide terminal.
 */
export class ContextBox implements Component {
  constructor(
    private getVisible: () => boolean,
    private getContextTokens: () => number,
    private getContextLimit: () => number,
  ) {}

  /** Outer box width in columns (fixed regardless of terminal width). */
  width(): number {
    return BOX_OUTER_WIDTH;
  }

  private renderBar(ratio: number): string {
    const clamped = Math.max(0, Math.min(1, ratio));
    const filled = Math.round(clamped * BAR_WIDTH);
    const color =
      clamped < 0.5
        ? chalk.greenBright
        : clamped < 0.8
          ? chalk.yellowBright
          : chalk.redBright;
    const bar =
      color("▰".repeat(filled)) + chalk.dim("▱".repeat(BAR_WIDTH - filled));
    return `[${bar}]`;
  }

  render(width: number): string[] {
    if (!this.getVisible()) return [];
    if (width < BOX_OUTER_WIDTH) return [];

    const limit = this.getContextLimit();

    // Borders span the inner area only — the corners account for the two
    // columns the content rows spend on `│`. Making these `INNER_WIDTH + 2`
    // wide pushes the row past the declared width, and the overlay compositor
    // then eats the right corner.
    const top = `╭${"─".repeat(INNER_WIDTH)}╮`;
    const bottom = `╰${"─".repeat(INNER_WIDTH)}╯`;

    let labelLine: string;
    let barLine: string;
    if (limit > 0) {
      const tokens = this.getContextTokens();
      const ratio = tokens / limit;
      const usage = `${formatTokenCount(tokens)}/${formatTokenCount(limit)}`;
      const pct = `${Math.round(Math.min(1, ratio) * 100)}%`;
      const bar = this.renderBar(ratio);

      // Line 1: label + usage, right-aligned within the inner area.
      const labelPlain = LABEL.length + 1 + usage.length;
      const labelLeftPad = " ".repeat(Math.max(0, INNER_WIDTH - labelPlain));
      labelLine = `${labelLeftPad}${chalk.dim(`${LABEL} `)}${usage}`;

      // Line 2: progress bar + percentage, right-aligned within the inner area.
      // bar is BAR_WIDTH + 2 brackets; +1 space before pct.
      const barPlain = BAR_WIDTH + 2 + 1 + pct.length;
      const barLeftPad = " ".repeat(Math.max(0, INNER_WIDTH - barPlain));
      barLine = `${barLeftPad}${bar} ${chalk.dim(pct)}`;
    } else {
      // Limit unknown — still show the box so the layout doesn't shift, but
      // render only the label so we don't fabricate a percentage.
      const label = `${LABEL} —`;
      const labelLeftPad = " ".repeat(Math.max(0, INNER_WIDTH - label.length));
      labelLine = `${labelLeftPad}${chalk.dim(label)}`;
      barLine = "";
    }

    const emptyPad = " ".repeat(INNER_WIDTH);
    const rows = [
      top,
      `│${labelLine}│`,
      `│${barLine || emptyPad}│`,
      bottom,
    ];
    // Pad on the left when the caller hands us more columns than the box needs,
    // so the box stays flush against the right edge it's anchored to.
    const leftPad = " ".repeat(width - BOX_OUTER_WIDTH);
    return rows.map((row) => leftPad + chalk.white(row));
  }

  invalidate(): void {}
}
