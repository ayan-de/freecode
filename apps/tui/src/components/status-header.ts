import { truncateToWidth, type Component } from "@earendil-works/pi-tui";
import chalk from "chalk";
import { MODE_BG_COLORS } from "../themes.js";
import { getModelDisplayString } from "../utils/display.js";
import { formatTokenCount } from "../utils/format-tokens.js";

type AgentMode = "plan" | "build" | "review" | "explore" | "danger";

const BAR_WIDTH = 10;

/**
 * StatusHeader — a single fixed line pinned to the top of the TUI.
 *
 * Hidden until the user submits their first message, after which it stays
 * visible: agent mode + model on the left, context-window usage with a
 * progress bar on the right. Because it's the TUI's first child it renders
 * above the scrollable history and never scrolls away.
 *
 * Height is 0 while hidden so the layout below it is untouched; callers use
 * `height()` to reserve the extra row for the message-list viewport.
 */
export class StatusHeader implements Component {
  constructor(
    private getVisible: () => boolean,
    private getMode: () => AgentMode,
    private getProvider: () => string,
    private getModel: () => string,
    private getContextTokens: () => number,
    private getContextLimit: () => number,
  ) {}

  /** Rendered row count: 0 while hidden, 1 once visible. */
  height(): number {
    return this.getVisible() ? 1 : 0;
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
    const bar = color("█".repeat(filled)) + chalk.dim("░".repeat(BAR_WIDTH - filled));
    return `[${bar}]`;
  }

  render(width: number): string[] {
    if (!this.getVisible()) return [];

    const mode = this.getMode();
    const badge = MODE_BG_COLORS[mode](chalk.bold.black(` ${mode} `));
    const badgePlain = mode.length + 2;

    const modelStr = getModelDisplayString(this.getProvider(), this.getModel());
    const left = `${badge}  ${chalk.dim(modelStr)}`;
    const leftPlain = badgePlain + 2 + modelStr.length;

    const tokens = this.getContextTokens();
    const limit = this.getContextLimit();
    let right = "";
    let rightPlain = 0;
    if (limit > 0) {
      const ratio = tokens / limit;
      const usage = `${formatTokenCount(tokens)}/${formatTokenCount(limit)}`;
      const pct = `${Math.round(Math.min(1, ratio) * 100)}%`;
      const label = "context ";
      right = `${chalk.dim(label + usage)} ${this.renderBar(ratio)} ${chalk.dim(pct)}`;
      // bar is BAR_WIDTH + 2 brackets; +1 space each side; +1 space before pct
      rightPlain = label.length + usage.length + 1 + BAR_WIDTH + 2 + 1 + pct.length;
    }

    // Account for the leading space and keep a small right margin so the
    // percentage isn't flush against (and clipped by) the terminal edge.
    const LEADING = 1;
    const RIGHT_MARGIN = 2;
    const gap = Math.max(
      1,
      width - LEADING - leftPlain - rightPlain - RIGHT_MARGIN,
    );
    const line = ` ${left}${" ".repeat(gap)}${right}`;
    return [truncateToWidth(line, width)];
  }

  invalidate(): void {}
}
