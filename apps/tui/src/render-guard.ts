// =============================================================================
// render-guard — enforces pi-tui's "one rendered line = one terminal row" rule.
//
// pi-tui renders differentially: it keeps the previous frame as an array of
// lines and assumes element N occupies terminal row N, so it can repaint just
// the changed rows with cursor-relative moves. Any rendered line that moves the
// cursor itself breaks that assumption — an embedded newline (a multi-line bash
// command in a tool header) consumes an extra row, a stray \r (progress-bar
// style tool output) rewinds to column 0 mid-row, and a line wider than the
// terminal wraps. From that point pi-tui's row math is off by however many rows
// it lost track of: it paints new content over the wrong rows, never erases the
// rows it no longer knows about, and the bottom of the layout slides past the
// last row. That is where the ghost status lines, the merged tool headers and
// the vanishing input box come from, and it gets worse the longer a session
// runs because there is more content to shift.
//
// The content that violates the rule is unbounded — arbitrary shell commands,
// tool output and model text all reach the screen — so the invariant is
// enforced once here, at the render boundary, instead of at every component
// that has to format untrusted text.
// =============================================================================

import {
  TUI,
  truncateToWidth,
  visibleWidth,
  type Component,
} from "@earendil-works/pi-tui";

/**
 * C0 controls that move the cursor on their own, plus DEL. Three are excluded
 * because the renderer needs them: ESC introduces every ANSI sequence, TAB is
 * expanded to spaces by pi-tui itself (and counted at that width), and BEL
 * terminates OSC/APC sequences — including pi-tui's own cursor marker.
 */
const CURSOR_MOVING_CONTROLS = /[\x00-\x06\x08\x0a-\x1a\x1c-\x1f\x7f]/g;

/**
 * Collapse a rendered line onto exactly one terminal row: neutralise the
 * controls that would move the cursor, then clip anything still wider than the
 * terminal. A space is used as the replacement so a flattened multi-line
 * command still reads as a command.
 */
export function sanitizeLine(line: string, width: number): string {
  let safe = line;
  // Fast path: most lines are already well-formed, and this runs on every
  // visible row of every frame.
  CURSOR_MOVING_CONTROLS.lastIndex = 0;
  if (CURSOR_MOVING_CONTROLS.test(safe)) {
    safe = safe.replace(CURSOR_MOVING_CONTROLS, " ");
  }
  if (width > 0 && visibleWidth(safe) > width) {
    safe = truncateToWidth(safe, width);
  }
  return safe;
}

export function sanitizeLines(lines: string[], width: number): string[] {
  return lines.map((line) => sanitizeLine(line, width));
}

/** Rolling render-cost figures, read by the Shift+Ctrl+D stats overlay. */
export interface FrameStats {
  /** Frames rendered since startup. */
  frames: number;
  /** Component-tree render cost of the last frame, ms (excludes the terminal write). */
  lastMs: number;
  /** Rolling mean / max over the last `WINDOW` frames. */
  avgMs: number;
  maxMs: number;
  /** Child renders served from / missed by the per-frame memo. */
  memoHits: number;
  memoMisses: number;
}

const STATS_WINDOW = 120;

/**
 * TUI that guarantees every line handed to the differential renderer occupies
 * exactly one row. `render` is the single point where the whole child tree's
 * output passes through, so the guard sits there.
 *
 * It is also the frame boundary, which makes it the home of two perf pieces:
 *
 * - A per-frame child-render memo (`renderChild`). Layout code measures
 *   heights by rendering sibling components (the message list's viewport
 *   callback, `inputChromeHeight`, overlay `visible` hooks), so before the
 *   memo the editor and mode line were fully rendered 3-4x per frame. pi-tui
 *   re-renders every child every frame regardless, so within one frame a
 *   component's output is stable and safe to reuse; the memo also survives
 *   into overlay compositing and click handling, where reusing the displayed
 *   frame's lines is more correct than re-rendering fresher state.
 * - Frame timing (`stats`), so optimization is measured, not eyeballed.
 */
export class SafeTUI extends TUI {
  private frameId = 0;
  private memo = new WeakMap<
    Component,
    { frame: number; width: number; lines: string[] }
  >();
  private durations: number[] = [];

  readonly stats: FrameStats = {
    frames: 0,
    lastMs: 0,
    avgMs: 0,
    maxMs: 0,
    memoHits: 0,
    memoMisses: 0,
  };

  /**
   * Render a child once per frame; every later caller in the same frame gets
   * the same lines. Callers outside a render pass (click handlers) get the
   * lines of the frame on screen. Falls through to a plain render when the
   * width differs (overlays measure at their own width).
   */
  renderChild(child: Component, width: number): string[] {
    const hit = this.memo.get(child);
    if (hit && hit.frame === this.frameId && hit.width === width) {
      this.stats.memoHits++;
      return hit.lines;
    }
    this.stats.memoMisses++;
    const lines = child.render(width);
    this.memo.set(child, { frame: this.frameId, width, lines });
    return lines;
  }

  override render(width: number): string[] {
    this.frameId++;
    const t0 = performance.now();
    const lines: string[] = [];
    for (const child of this.children) {
      for (const line of this.renderChild(child, width)) {
        lines.push(line);
      }
    }
    const out = sanitizeLines(lines, width);

    const elapsed = performance.now() - t0;
    this.stats.frames++;
    this.stats.lastMs = elapsed;
    this.durations.push(elapsed);
    if (this.durations.length > STATS_WINDOW) this.durations.shift();
    let sum = 0;
    let max = 0;
    for (const d of this.durations) {
      sum += d;
      if (d > max) max = d;
    }
    this.stats.avgMs = sum / this.durations.length;
    this.stats.maxMs = max;
    return out;
  }
}
