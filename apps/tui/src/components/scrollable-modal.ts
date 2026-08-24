import {
  Key,
  matchesKey,
  truncateToWidth,
  visibleWidth,
  type Component,
} from "@earendil-works/pi-tui";
import chalk from "chalk";

// Card colors. Accent matches QuestionModal; unlike that card this one is
// transparent — the border and text sit straight on the transcript.
const ACCENT = "#FFD700";
const DIM = "#666666";

/** Blank columns between the content and the card's side borders. */
const PAD_X = 2;
/**
 * Rows the chrome costs: top border, a blank under the title, a blank above
 * the hint, the hint itself, and the bottom border.
 */
const CHROME_ROWS = 5;
/** Never shrink the viewport below this, even on a very short terminal. */
const MIN_VIEWPORT_ROWS = 3;
const MIN_INNER_WIDTH = 24;

const DEFAULT_HINT = "↑↓ scroll · pgup/pgdn page · esc close";

/**
 * ScrollableModal — a bordered card that pages content too tall for the
 * terminal, instead of losing it.
 *
 * This exists because nothing else in the TUI is height-aware: NoticeModal,
 * CompactionModal and QuestionModal each return a fixed `string[]`, and
 * pi-tui's `maxHeight` does not scroll — it does `slice(0, maxHeight)`, so an
 * over-tall card silently loses its tail. For a report whose last lines are the
 * summary (`/context` ends with free space and the estimate caveat) that drops
 * exactly what the reader opened it for.
 *
 * Content is supplied as a `renderContent(innerWidth)` callback rather than a
 * fixed array so width-responsive bodies re-lay themselves out on resize, and
 * so the body can clip to the real inner width instead of being clipped twice.
 *
 * Capturing overlay: scrolling needs the arrow keys, which would otherwise
 * reach the editor or the transcript scrollback.
 */
export class ScrollableModal implements Component {
  private scroll = 0;
  /**
   * Resolved per render, not captured at open: the terminal can be resized
   * while the card is up, and a card sized to the old height is exactly the
   * silent-clip failure this component exists to avoid.
   */
  private maxRowsSource: () => number = () => 24;
  /**
   * Largest useful scroll offset, refreshed on every render. `handleInput` has
   * no width and so cannot recompute it; render always precedes input for a
   * visible overlay, and render re-clamps anyway, so a stale value self-corrects
   * on the next frame rather than scrolling past the end.
   */
  private maxScroll = 0;
  /** Body rows currently on screen — the page size for PgUp/PgDn. */
  private pageSize = 1;

  constructor(
    private readonly title: string,
    private readonly renderContent: (innerWidth: number) => string[],
    private readonly onClose: () => void,
    private readonly hint: string = DEFAULT_HINT,
  ) {}

  /**
   * Rows the card may occupy in total, borders included. The caller owns this
   * because only it knows the terminal height and what else is on screen.
   * Pass a function to have it re-read on every frame (resize-safe).
   */
  setMaxRows(rows: number | (() => number)): void {
    this.maxRowsSource = typeof rows === "function" ? rows : () => rows;
  }

  private get maxRows(): number {
    return Math.max(CHROME_ROWS + MIN_VIEWPORT_ROWS, this.maxRowsSource());
  }

  /** Total rows available to the body, indicators included. */
  private viewportRows(): number {
    return Math.max(MIN_VIEWPORT_ROWS, this.maxRows - CHROME_ROWS);
  }

  /** Rows this card will actually render at `width` — feeds overlay sizing. */
  heightFor(width: number): number {
    const content = this.renderContent(this.innerWidth(width) - PAD_X * 2);
    return Math.min(this.maxRows, content.length + CHROME_ROWS);
  }

  private innerWidth(width: number): number {
    return Math.max(MIN_INNER_WIDTH, width - 2);
  }

  render(width: number): string[] {
    const inner = this.innerWidth(width);
    const bodyWidth = inner - PAD_X * 2;
    const content = this.renderContent(bodyWidth);

    const accent = (s: string): string => chalk.hex(ACCENT)(s);
    const dim = (s: string): string => chalk.hex(DIM)(s);
    const border = accent("│");

    const viewport = this.viewportRows();
    const overflows = content.length > viewport;
    // Indicator rows are reserved for the whole scroll, not just when there is
    // something in that direction — otherwise the body jumps by a row the
    // moment you scroll off the top.
    const bodyRows = overflows ? Math.max(1, viewport - 2) : content.length;

    this.pageSize = bodyRows;
    this.maxScroll = Math.max(0, content.length - bodyRows);
    if (this.scroll > this.maxScroll) this.scroll = this.maxScroll;
    if (this.scroll < 0) this.scroll = 0;

    const row = (text: string): string => {
      const clipped =
        visibleWidth(text) > bodyWidth
          ? truncateToWidth(text, bodyWidth)
          : text;
      // The card is transparent — no background fill. The padding and fill are
      // still emitted as plain spaces: every row must be exactly `width`
      // columns or the overlay composite breaks for the whole screen.
      const fill = " ".repeat(Math.max(0, bodyWidth - visibleWidth(clipped)));
      const pad = " ".repeat(PAD_X);
      return `${border}${pad}${clipped}${fill}${pad}${border}`;
    };
    const blank = (): string => row("");

    const rows: string[] = [];

    // Top: ╭─ <title> ─…─╮
    const titleText = ` ${this.title} `;
    const topDashes = Math.max(0, inner - visibleWidth(titleText) - 1);
    rows.push(
      accent("╭─") +
        chalk.bold(titleText) +
        accent("─".repeat(topDashes) + "╮"),
    );
    rows.push(blank());

    if (overflows) {
      rows.push(
        row(this.scroll > 0 ? dim(`… ${this.scroll} more above`) : ""),
      );
    }
    for (const line of content.slice(this.scroll, this.scroll + bodyRows)) {
      rows.push(row(line));
    }
    if (overflows) {
      const below = content.length - this.scroll - bodyRows;
      rows.push(row(below > 0 ? dim(`… ${below} more below`) : ""));
    }

    rows.push(blank());
    rows.push(row(dim(overflows ? this.hint : "esc close")));
    rows.push(accent("╰" + "─".repeat(inner) + "╯"));

    return rows;
  }

  handleInput(data: string): void {
    if (matchesKey(data, Key.escape) || data === "q") {
      this.onClose();
      return;
    }
    if (matchesKey(data, Key.up) || data === "k") {
      this.scrollBy(-1);
      return;
    }
    if (matchesKey(data, Key.down) || data === "j") {
      this.scrollBy(1);
      return;
    }
    if (matchesKey(data, Key.pageUp)) {
      this.scrollBy(-this.pageSize);
      return;
    }
    if (matchesKey(data, Key.pageDown) || data === " ") {
      this.scrollBy(this.pageSize);
      return;
    }
    if (matchesKey(data, Key.home) || data === "g") {
      this.scroll = 0;
      return;
    }
    if (matchesKey(data, Key.end) || data === "G") {
      this.scroll = this.maxScroll;
    }
  }

  private scrollBy(delta: number): void {
    this.scroll = Math.min(this.maxScroll, Math.max(0, this.scroll + delta));
  }

  invalidate(): void {}
}
