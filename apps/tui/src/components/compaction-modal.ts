import {
  truncateToWidth,
  visibleWidth,
  type Component,
} from "@earendil-works/pi-tui";
import chalk from "chalk";

/** Blank columns between the content and the modal's left/right edges. */
const PAD_X = 3;
/** Inner width of the box; the bar and labels are laid out against this. */
const INNER_WIDTH = 40;
/** Width of the lit segment that sweeps across the track. */
const SWEEP_WIDTH = 12;

const TRACK_CHAR = "─";
const FILL_CHAR = "━";

/**
 * CompactionModal — centered progress modal shown while a conversation is
 * being summarized.
 *
 * The bar is deliberately *indeterminate*: compaction is a single
 * summarization request, so there is no intermediate progress to report. A
 * percentage here would be invented. The sweeping segment communicates "still
 * working" honestly; the real information is the token count on completion.
 *
 * Lifecycle: constructed on compaction_start, driven by tick() on a timer,
 * finished with complete() or fail(), then hidden by the caller.
 */
export class CompactionModal implements Component {
  private frame = 0;
  private state: "running" | "done" | "failed" = "running";
  private tokensBefore = 0;
  private tokensAfter = 0;
  private message = "";

  constructor(private readonly title = "Compacting conversation") {}

  /** Advance the sweep one step. Caller re-renders. */
  tick(): void {
    this.frame += 1;
  }

  /** Switch to the finished state showing the reduction achieved. */
  complete(tokensBefore: number, tokensAfter: number): void {
    this.state = "done";
    this.tokensBefore = tokensBefore;
    this.tokensAfter = tokensAfter;
  }

  /** Switch to a terminal state that explains why nothing happened. */
  fail(message: string): void {
    this.state = "failed";
    this.message = message;
  }

  width(): number {
    return INNER_WIDTH + PAD_X * 2;
  }

  /**
   * Full-width row padded with plain spaces — no background fill, so the
   * overlay composites over the transcript instead of covering it. Content is
   * clipped as well as padded: on a narrow terminal the heading is wider than
   * the box, and a row that overruns breaks the whole overlay's geometry.
   */
  private row(content: string, width: number): string {
    const inner = Math.max(1, width - PAD_X * 2);
    const clipped =
      visibleWidth(content) > inner ? truncateToWidth(content, inner) : content;
    const fill = " ".repeat(Math.max(0, inner - visibleWidth(clipped)));
    const pad = " ".repeat(PAD_X);
    return `${pad}${clipped}${fill}${pad}`;
  }

  /**
   * Indeterminate bar: a lit segment bounces across the track. Bouncing rather
   * than wrapping so the motion stays legible at narrow widths.
   */
  private bar(inner: number): string {
    const track = Math.max(4, inner);
    const span = Math.min(SWEEP_WIDTH, Math.floor(track / 2));
    const travel = Math.max(1, (track - span) * 2);
    const position = this.frame % travel;
    const start = position <= track - span ? position : travel - position;

    const before = TRACK_CHAR.repeat(Math.max(0, start));
    const lit = FILL_CHAR.repeat(span);
    const after = TRACK_CHAR.repeat(Math.max(0, track - start - span));
    return (
      chalk.hex("#4A4A4A")(before) +
      chalk.cyanBright(lit) +
      chalk.hex("#4A4A4A")(after)
    );
  }

  /** Solid full bar for terminal states — no motion once there's nothing to wait for. */
  private solidBar(inner: number, color: (s: string) => string): string {
    return color(FILL_CHAR.repeat(Math.max(4, inner)));
  }

  render(width: number): string[] {
    const inner = Math.max(8, width - PAD_X * 2);
    const blank = " ".repeat(width);

    const heading =
      this.state === "running"
        ? chalk.whiteBright(this.title)
        : this.state === "done"
          ? chalk.whiteBright(this.title)
          : chalk.whiteBright("Compaction skipped");

    const bar =
      this.state === "running"
        ? this.bar(inner)
        : this.state === "done"
          ? this.solidBar(inner, chalk.cyanBright)
          : this.solidBar(inner, (s) => chalk.hex("#4A4A4A")(s));

    let detail: string;
    if (this.state === "done") {
      const before = this.tokensBefore.toLocaleString();
      const after = this.tokensAfter.toLocaleString();
      const saved = Math.max(0, this.tokensBefore - this.tokensAfter);
      const pct =
        this.tokensBefore > 0
          ? Math.round((saved / this.tokensBefore) * 100)
          : 0;
      detail =
        chalk.gray("~") +
        chalk.whiteBright(before) +
        chalk.gray("  →  ") +
        chalk.greenBright(`~${after}`) +
        chalk.gray(` tokens (−${pct}%)`);
    } else if (this.state === "failed") {
      detail = chalk.gray(this.message);
    } else {
      detail = chalk.gray("Summarizing earlier turns…");
    }

    return [
      blank,
      this.row(heading, width),
      blank,
      this.row(bar, width),
      blank,
      this.row(detail, width),
      blank,
    ];
  }

  invalidate(): void {}
}
