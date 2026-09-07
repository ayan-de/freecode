import { visibleWidth, type Component } from "@earendil-works/pi-tui";
import chalk from "chalk";
import type { EffortLevel } from "@thisisayande/freecode-shared";
import { MODE_BG_COLORS } from "../themes.js";
import { getModelDisplayString } from "../utils/display.js";

type AgentMode = "plan" | "build" | "review" | "explore" | "danger";

/** Same yellow the /shells card uses for its border, so the two read as one. */
const SHELLS_CHIP_BG = "#FFD700";

/**
 * ModeLine — the mode/model line rendered just below the input.
 *
 * Renders nothing once `getHidden()` is true. The previous top StatusHeader
 * used to carry the same mode/model info from the first prompt onward, which
 * is why this used to hide then — that header has since been retired (its
 * context widget lives in a top-right overlay), so callers pass a getter that
 * always returns false to keep mode/model visible at all times.
 *
 * Reads all state through getters so cycling the mode or changing the model
 * only needs a re-render, no child swapping.
 */
export class ModeLine implements Component {
  constructor(
    private getHidden: () => boolean,
    private getMode: () => AgentMode,
    private getProvider: () => string,
    private getModel: () => string,
    private getEffort: () => EffortLevel,
    /**
     * Background shells still running. Rendered as a chip left of Effort so a
     * dev server the agent started stays visible without opening /shells —
     * otherwise a forgotten process is invisible until it holds a port.
     */
    private getRunningShells: () => number = () => 0,
  ) {}

  render(width: number): string[] {
    if (this.getHidden()) return [];
    const mode = this.getMode();
    const modeText = MODE_BG_COLORS[mode](
      chalk.bold.black(` ${mode.toUpperCase()} `),
    );
    const hintText = chalk.dim(" (shift+tab to cycle)");
    const modelText = `${chalk.bold.whiteBright("Model:")} ${chalk.dim(
      getModelDisplayString(this.getProvider(), this.getModel()),
    )}`;
    const left = ` ${modeText}${hintText}  ${modelText}`;

    const effortText = `${chalk.bold.whiteBright("Effort:")} ${chalk.dim(
      this.getEffort(),
    )} `;

    // Only when something is actually running: a permanently-present chip
    // reading (0) is chrome, not information.
    const running = this.getRunningShells();
    const chipLabel = ` /shells (${running}) `;
    // Mode and model are the line's job; the chip is an extra. On a terminal
    // too narrow for both it drops out rather than pushing the line past
    // `width` and wrapping — the count is still one keystroke away in /shells.
    const roomForChip =
      width -
      visibleWidth(left) -
      visibleWidth(effortText) -
      chipLabel.length -
      2;
    const shellsText =
      running > 0 && roomForChip >= 1
        ? chalk.bgHex(SHELLS_CHIP_BG)(chalk.bold.black(chipLabel)) + "  "
        : "";

    const right = `${shellsText}${effortText}`;
    const gap = Math.max(1, width - visibleWidth(left) - visibleWidth(right));
    return [`${left}${" ".repeat(gap)}${right}`];
  }

  invalidate(): void {}
}
