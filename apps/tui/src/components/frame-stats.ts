import { type Component, truncateToWidth } from "@earendil-works/pi-tui";
import chalk from "chalk";
import type { FrameStats } from "../render-guard.js";

/**
 * Shift+Ctrl+D debug overlay: live render cost and per-frame memo hit rate
 * from SafeTUI. Numbers cover the component-tree render only — the terminal
 * diff/write happens after and isn't measurable from this side of pi-tui.
 */
export class FrameStatsOverlay implements Component {
  constructor(private stats: FrameStats) {}

  invalidate(): void {
    // Stateless view over SafeTUI.stats — nothing to drop.
  }

  width(): number {
    return 46;
  }

  render(width: number): string[] {
    const s = this.stats;
    const asked = s.memoHits + s.memoMisses;
    const hitPct = asked > 0 ? Math.round((100 * s.memoHits) / asked) : 0;
    const rows = [
      `render ${s.lastMs.toFixed(1)}ms · avg ${s.avgMs.toFixed(1)}ms · max ${s.maxMs.toFixed(1)}ms`,
      `frames ${s.frames} · memo ${hitPct}% hit (${s.memoHits}/${asked})`,
    ];
    return rows.map((r) => chalk.bgBlackBright(chalk.white(truncateToWidth(` ${r} `, width))));
  }
}
