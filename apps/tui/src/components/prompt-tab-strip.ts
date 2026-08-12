import { truncateToWidth, type Component } from "@earendil-works/pi-tui";
import chalk from "chalk";
import {
  getActivePromptIndex,
  getPromptCount,
  setActivePromptIndex,
  subscribeToMessages,
} from "../state/message-store.js";

/** Filled square that stands in for the active page's number. */
const ACTIVE_MARKER = "■";

/**
 * One step of tab navigation: given the active tab and the tab count,
 * return the tab a prev/next keypress should land on. Wraps at both
 * ends. Exported (and pure) so the keybinding behaviour is testable
 * without driving the whole TUI's input listener.
 */
export function stepTab(
  active: number | undefined,
  total: number,
  direction: "prev" | "next",
): number | undefined {
  if (total <= 0) return undefined;
  const here = active ?? (direction === "prev" ? 1 : total);
  if (direction === "prev") return here <= 1 ? total : here - 1;
  return here >= total ? 1 : here + 1;
}

/**
 * PromptTabStrip — single-row tab bar pinned at the top of the chat that
 * shows one tab per submitted prompt in this session, modeled after the OS
 * window-switcher in the user's screenshot:
 *
 *   `1  2  3  ⬛  5`
 *
 * The active prompt is rendered as a filled square (no number); inactive
 * prompts show their 1-based index. The whole row sits inside a dim
 * bracket so it's visually distinct from the chat below, and uses the
 * terminal's full width with consistent spacing — equal gaps between
 * cells regardless of count.
 *
 * Hidden when no prompts have been submitted yet (zero tabs means nothing
 * to render). Auto-switches to the most recently submitted prompt (the
 * store sets `activePromptIndex` on every `user` add), so the chat
 * follows the user's intent without an extra click.
 *
 * Click handling: each tab maps to a fixed column range; clicks within
 * the strip's row switch the active tab. Keyboard handling lives in
 * index.ts (Left/Right arrows) so it stays in one place with the rest
 * of the global hotkeys.
 */
export class PromptTabStrip implements Component {
  private total = 0;
  private active: number | undefined;
  private unsubscribe: (() => void) | null = null;

  /**
   * Last rendered line widths per tab — used by handleClick to map a
   * mouse column to the tab under the cursor. Recomputed each render
   * so a width change (resize, prompt added) stays in sync.
   */
  private tabColumns: number[] = [];

  constructor() {
    this.total = getPromptCount();
    this.active = getActivePromptIndex();
    this.unsubscribe = subscribeToMessages(() => {
      const newTotal = getPromptCount();
      const newActive = getActivePromptIndex();
      if (newTotal !== this.total || newActive !== this.active) {
        this.total = newTotal;
        this.active = newActive;
      }
    });
  }

  /** Height is 1 row once any prompt exists, 0 otherwise. */
  height(): number {
    return this.total > 0 ? 1 : 0;
  }

  /** Current number of tabs. Exposed for tests + index.ts. */
  getTabCount(): number {
    return this.total;
  }

  /** Current active tab index (1-based) or undefined if none. */
  getActiveTab(): number | undefined {
    return this.active;
  }

  /** Switch tabs from the outside (e.g. Left/Right arrow handlers). */
  setActiveTab(promptIndex: number): void {
    setActivePromptIndex(promptIndex);
  }

  /**
   * Build the visible tab labels. Public so tests can assert the
   * ordering and active-tab marker without going through mouse coords.
   */
  getTabLabels(): string[] {
    const labels: string[] = [];
    for (let i = 1; i <= this.total; i++) {
      labels.push(i === this.active ? ACTIVE_MARKER : String(i));
    }
    return labels;
  }

  /**
   * Approximate column ranges for each tab, recomputed each render. Used
   * by `handleClick` to map a mouse x coordinate to a tab index. The
   * stored values include the padding space; the clickable "hit area"
   * for tab N spans from `start[N]` to `start[N] + labelLen` (we accept
   * clicks anywhere in the slot so a small mouse-target is fine).
   */
  private recomputeColumns(width: number): void {
    const labels = this.getTabLabels();
    if (labels.length === 0) {
      this.tabColumns = [];
      return;
    }
    // Match the renderer's spacing: " 1  2  3  ■  5 " — single-space
    // gap between cells, no leading/trailing space beyond the pad.
    const padLeft = 1;
    const cols: number[] = [];
    let x = padLeft;
    for (let i = 0; i < labels.length; i++) {
      cols.push(x);
      x += labels[i]!.length + 1; // label + space separator
    }
    // Trim last trailing space so the strip hugs the right edge of the
    // available width — visually matches the OS screenshot, and the
    // trailing-column drop keeps click math simple.
    this.tabColumns = cols.map((c) => Math.min(c, Math.max(0, width - 1)));
  }

  /** Returns the active tab index for a given screen column, or null. */
  tabIndexAtColumn(cx: number): number | null {
    if (this.tabColumns.length === 0) return null;
    // Walk columns left-to-right; the column whose slot contains `cx`
    // is the click target.
    for (let i = 0; i < this.tabColumns.length; i++) {
      const start = this.tabColumns[i]!;
      const end =
        i + 1 < this.tabColumns.length ? this.tabColumns[i + 1]! : start + 4; // last tab — generous hit area
      if (cx >= start && cx < end) return i + 1;
    }
    return null;
  }

  /**
   * Click handler invoked by the parent TUI's mouse listener. Returns
   * true when the click was consumed (inside the strip row and hit a
   * tab), false otherwise so the chat list's own click handler can run.
   */
  handleClick(cx: number, _cy: number): boolean {
    if (this.total === 0) return false;
    const tabIndex = this.tabIndexAtColumn(cx);
    if (tabIndex === null) return false;
    if (tabIndex === this.active) return true; // already on this tab
    setActivePromptIndex(tabIndex);
    return true;
  }

  render(width: number): string[] {
    if (this.total === 0) return [];

    const labels = this.getTabLabels();
    // Pad-right with a dim "│" so the strip has a visual anchor on the
    // right edge (the OS screenshot uses a thin separator). Truncate
    // before coloring so ANSI escape codes don't pollute visibleWidth.
    const raw = labels.join(" ");
    this.recomputeColumns(width);
    const stripped = truncateToWidth(raw, width - 1);
    // Colour after truncation, per label, so the escape codes never enter
    // the width math: unselected page numbers are dim yellow and the
    // active marker is full yellow, so the current page reads as the one
    // lit cell in the row.
    const painted = stripped
      .split(" ")
      .map((cell) => (cell === ACTIVE_MARKER ? chalk.yellow(cell) : chalk.yellow.dim(cell)))
      .join(" ");
    return [chalk.dim("│ ") + painted];
  }

  /**
   * Cleanup subscription when the strip is destroyed (session change,
   * TUI teardown).
   */
  destroy(): void {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
  }

  /** No cached render state to drop — the strip recomputes every frame. */
  invalidate(): void {}
}
