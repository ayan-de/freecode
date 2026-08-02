import { type Component } from "@earendil-works/pi-tui";
import chalk from "chalk";
import { MODE_BG_COLORS } from "../themes.js";
import { getModelDisplayString } from "../utils/display.js";

type AgentMode = "plan" | "build" | "review" | "explore" | "danger";

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
  ) {}

  render(): string[] {
    if (this.getHidden()) return [];
    const mode = this.getMode();
    const modeText = MODE_BG_COLORS[mode](
      chalk.bold.black(` ${mode.toUpperCase()} `),
    );
    const hintText = chalk.dim(" (shift+tab to cycle)");
    const modelText = `${chalk.bold.whiteBright("Model:")} ${chalk.dim(
      getModelDisplayString(this.getProvider(), this.getModel()),
    )}`;
    return [` ${modeText}${hintText}  ${modelText}`];
  }

  invalidate(): void {}
}
