import type { Component } from "@earendil-works/pi-tui";
import type { ContextBreakdown } from "@thisisayande/freecode-shared";
import { renderContextReport } from "../utils/context-report.js";

/**
 * The `/context` report as a transcript row.
 *
 * Its own component rather than a system message: system messages are wrapped
 * in `chalk.dim`, which washes out the per-category colors that are the whole
 * point of the grid. Rendering is deferred to `render(width)` so the grid
 * re-lays itself out when the terminal is resized.
 */
export class ContextReportMessage implements Component {
  constructor(private stats: ContextBreakdown) {}

  render(width: number): string[] {
    return renderContextReport(this.stats, width);
  }

  getMinWidth(): number {
    return 44;
  }

  getMinHeight(): number {
    return 1;
  }

  invalidate(): void {}
  addChild(_component: Component): void {}
  destroy(): void {}
}
