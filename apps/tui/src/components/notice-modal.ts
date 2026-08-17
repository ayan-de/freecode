import {
  visibleWidth,
  wrapTextWithAnsi,
  type Component,
} from "@earendil-works/pi-tui";
import chalk from "chalk";
import { STATUS_BAR_BG } from "../themes.js";

/** Blank columns between the text and the modal's left/right edges. */
const PAD_X = 2;

/**
 * NoticeModal — a transient borderless notice.
 *
 * Used for ephemeral feedback (e.g. "Copied N chars"). The dark background
 * hugs the message as a single line; it only spills onto further rows if the
 * terminal is too narrow to fit it. `padY` adds that many blank background rows
 * above and below, for notices that want a taller block instead of a strip.
 * Shown through a non-capturing overlay so it never steals focus from the
 * editor, and hidden again by the caller.
 *
 * Pass `border: true` (and `borderColor`) to draw a thin box around the
 * notice instead of the dark fill — useful for persistent affordances (e.g.
 * the jump-to-bottom pill) that shouldn't look like a toast.
 *
 * Pass `padX: 0` to hug the text flush against the border (no horizontal
 * inset). Default is the standard `PAD_X` cols of inset.
 */
export class NoticeModal implements Component {
  constructor(
    private message: string,
    private padY = 0,
    private options: {
      border?: boolean;
      borderColor?: (s: string) => string;
      padX?: number;
    } = {},
  ) {}

  /** Overlay width that fits the message on one line, padding included. */
  width(): number {
    const padX = this.options.padX ?? PAD_X;
    const inner = visibleWidth(this.message) + padX * 2;
    return this.options.border ? inner + 2 : inner;
  }

  render(width: number): string[] {
    const padX = this.options.padX ?? PAD_X;
    const inner = Math.max(1, width - padX * 2 - (this.options.border ? 2 : 0));
    const pad = " ".repeat(padX);
    const content = wrapTextWithAnsi(this.message, inner).map((line) => {
      const fill = " ".repeat(Math.max(0, inner - visibleWidth(line)));
      const styled = chalk.whiteBright(`${pad}${line}${fill}${pad}`);
      return this.options.border ? styled : STATUS_BAR_BG(styled);
    });
    const blank = this.options.border
      ? " ".repeat(width)
      : STATUS_BAR_BG(" ".repeat(width));
    const padRows = Array<string>(this.padY).fill(blank);
    const body = padRows.length > 0
      ? [...padRows, ...content, ...padRows]
      : content;
    if (!this.options.border) return body;
    const color = this.options.borderColor ?? chalk.dim;
    const top = color("╭" + "─".repeat(width - 2) + "╮");
    const bottom = color("╰" + "─".repeat(width - 2) + "╯");
    const framed = body.map((line) => color("│") + line + color("│"));
    return [top, ...framed, bottom];
  }

  invalidate(): void {}
}
