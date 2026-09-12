import { visibleWidth, type Component } from "@earendil-works/pi-tui";
import chalk from "chalk";
import type { EffortLevel } from "@thisisayande/freecode-shared";
import { MODE_BG_COLORS } from "../themes.js";
import { getModelDisplayString } from "../utils/display.js";

type AgentMode = "plan" | "build" | "review" | "explore" | "danger";

/** Same yellow the /shells card uses for its border, so the two read as one. */
const SHELLS_CHIP_BG = "#FFD700";
/** Same cyan the /agents card uses, for the same reason. */
const AGENTS_CHIP_BG = "#5FD7FF";

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
    private getEffort: () => EffortLevel | undefined,
    /**
     * Background shells still running. Rendered as a chip left of Effort so a
     * dev server the agent started stays visible without opening /shells —
     * otherwise a forgotten process is invisible until it holds a port.
     */
    private getRunningShells: () => number = () => 0,
    /**
     * Subagents still running. Rendered as a second chip left of the shells
     * one: delegated work is otherwise invisible until its tool result lands,
     * so a long-running agent looks like a hung turn.
     */
    private getRunningAgents: () => number = () => 0,
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

    // No level set means the provider's own default, which is not "low" —
    // rendering a level we never sent would misreport what the turn ran at.
    const effortText = `${chalk.bold.whiteBright("Effort:")} ${chalk.dim(
      this.getEffort() ?? "default",
    )} `;

    // Only when something is actually running: a permanently-present chip
    // reading (0) is chrome, not information.
    //
    // Mode and model are the line's job; the chips are an extra. On a terminal
    // too narrow they drop out rather than pushing the line past `width` and
    // wrapping — the counts are still one keystroke away in /shells and
    // /agents. Budget is spent right-to-left, so the shells chip (nearer the
    // Effort block) survives a squeeze that drops the agents one.
    let budget = width - visibleWidth(left) - visibleWidth(effortText) - 2;

    const chip = (label: string, bg: string, count: number): string => {
      if (count <= 0 || budget < label.length + 2) return "";
      budget -= label.length + 2;
      return chalk.bgHex(bg)(chalk.bold.black(label)) + "  ";
    };

    const shellsText = chip(
      ` /shells (${this.getRunningShells()}) `,
      SHELLS_CHIP_BG,
      this.getRunningShells(),
    );
    const agentsText = chip(
      ` /agents (${this.getRunningAgents()}) `,
      AGENTS_CHIP_BG,
      this.getRunningAgents(),
    );

    const right = `${agentsText}${shellsText}${effortText}`;
    const gap = Math.max(1, width - visibleWidth(left) - visibleWidth(right));
    return [`${left}${" ".repeat(gap)}${right}`];
  }

  invalidate(): void {}
}
