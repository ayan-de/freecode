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
 */
export class NoticeModal implements Component {
  constructor(
    private message: string,
    private padY = 0,
  ) {}

  /** Overlay width that fits the message on one line, padding included. */
  width(): number {
    return visibleWidth(this.message) + PAD_X * 2;
  }

  render(width: number): string[] {
    const inner = Math.max(1, width - PAD_X * 2);
    const pad = " ".repeat(PAD_X);
    const rows = wrapTextWithAnsi(this.message, inner).map((line) => {
      const fill = " ".repeat(Math.max(0, inner - visibleWidth(line)));
      return STATUS_BAR_BG(chalk.whiteBright(`${pad}${line}${fill}${pad}`));
    });
    if (this.padY === 0) return rows;
    const blank = Array<string>(this.padY).fill(
      STATUS_BAR_BG(" ".repeat(width)),
    );
    return [...blank, ...rows, ...blank];
  }

  invalidate(): void {}
}
