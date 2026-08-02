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

import { TUI, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

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

/**
 * TUI that guarantees every line handed to the differential renderer occupies
 * exactly one row. `render` is the single point where the whole child tree's
 * output passes through, so the guard sits there.
 */
export class SafeTUI extends TUI {
  override render(width: number): string[] {
    return sanitizeLines(super.render(width), width);
  }
}
