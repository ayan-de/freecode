// =============================================================================
// Context report — renders the `/context` grid from a core-computed breakdown.
// Pure formatting: every number comes from core via `context.stats`.
// =============================================================================

import chalk from "chalk";
import type {
  ContextBreakdown,
  ContextSegmentId,
} from "@thisisayande/freecode-shared";
import { formatTokenCount } from "./format-tokens.js";

const GRID_COLS = 20;
const GRID_ROWS = 10;
const TOTAL_CELLS = GRID_COLS * GRID_ROWS;

const USED_CELL = "⛁";
const FREE_CELL = "⛶";

const INDENT = 2;
/** Blank columns between the grid and the legend. */
const GUTTER = 3;
/** Narrower than this and a legend label is shredded — stack it below instead. */
const MIN_LEGEND_WIDTH = 26;

/**
 * One color per category, so the grid and the legend read as the same object.
 * Hex rather than the 16-color names: several categories are neighbours in the
 * legend and the basic palette does not have enough distinguishable hues.
 */
const SEGMENT_COLORS: Record<ContextSegmentId, string> = {
  "system-prompt": "#d78700",
  "project-instructions": "#5fafff",
  skills: "#00afaf",
  "memory-guidance": "#af87ff",
  tools: "#ff5f87",
  "mcp-tools": "#ff875f",
  "compaction-summary": "#87875f",
  memories: "#af5fff",
  todos: "#5fd75f",
  "project-context": "#00d7af",
  messages: "#ffd75f",
};

const FREE_COLOR = "#585858";

/**
 * Hand out `totalCells` among the segments in proportion to their tokens.
 *
 * Largest-remainder rather than plain rounding: the cells are a fixed-size grid,
 * so the counts have to sum to exactly `totalCells` or the last row comes out
 * ragged. Any segment with a non-zero share gets at least one cell — a category
 * that is present but invisible is worse than one pixel of over-statement.
 */
export function allocateCells(
  weights: number[],
  totalCells: number,
): number[] {
  const total = weights.reduce((sum, w) => sum + w, 0);
  if (total <= 0) return weights.map(() => 0);

  const exact = weights.map((w) => (w / total) * totalCells);
  const counts = exact.map((value, i) =>
    weights[i]! > 0 ? Math.max(1, Math.floor(value)) : 0,
  );

  let remaining = totalCells - counts.reduce((sum, c) => sum + c, 0);
  // Hand out leftovers to the biggest fractional parts; claw back from the
  // biggest allocations if the min-one-cell floor overshot the grid.
  const order = exact
    .map((value, i) => ({ i, frac: value - Math.floor(value) }))
    .sort((a, b) => b.frac - a.frac)
    .map((e) => e.i);

  for (let n = 0; remaining > 0 && n < order.length * totalCells; n++) {
    counts[order[n % order.length]!]!++;
    remaining--;
  }
  while (remaining < 0) {
    const biggest = counts.reduce(
      (best, c, i) => (c > counts[best]! ? i : best),
      0,
    );
    if (counts[biggest]! <= 1) break;
    counts[biggest]!--;
    remaining++;
  }
  return counts;
}

function percent(part: number, whole: number): string {
  if (whole <= 0) return "—";
  const pct = (part / whole) * 100;
  return pct < 0.1 && part > 0 ? "<0.1%" : `${pct.toFixed(1)}%`;
}

/**
 * Render the report as pre-colored terminal lines: a 20x10 grid on the left,
 * one legend entry per row on the right.
 *
 * When core could not resolve a context limit (unknown model / offline
 * models.dev), the grid shows the *composition* of what is used rather than
 * occupancy of a window, and the header says so — a grid drawn against a made-up
 * denominator would be worse than no grid.
 */
export function renderContextReport(
  stats: ContextBreakdown,
  width: number,
): string[] {
  const limit = stats.contextLimit ?? 0;
  const free = limit > 0 ? Math.max(0, limit - stats.usedTokens) : 0;

  // Legend order: biggest first, free space last — the two questions a reader
  // has are "what is eating my window" and "how much is left".
  const segments = [...stats.segments].sort((a, b) => b.tokens - a.tokens);
  const weights = segments.map((s) => s.tokens);
  const cells = allocateCells(
    limit > 0 ? [...weights, free] : weights,
    TOTAL_CELLS,
  );

  const glyphs: string[] = [];
  segments.forEach((segment, i) => {
    const color = chalk.hex(SEGMENT_COLORS[segment.id] ?? "#ffffff");
    for (let n = 0; n < (cells[i] ?? 0); n++) glyphs.push(color(USED_CELL));
  });
  if (limit > 0) {
    const freeCells = cells[segments.length] ?? 0;
    for (let n = 0; n < freeCells; n++) {
      glyphs.push(chalk.hex(FREE_COLOR)(FREE_CELL));
    }
  }
  // Guard against a short grid if every weight was zero (a brand-new session).
  while (glyphs.length < TOTAL_CELLS) glyphs.push(chalk.hex(FREE_COLOR)(FREE_CELL));

  // Legend text is built plain so it can be truncated by character count —
  // slicing a string with ANSI escapes in it cuts the escapes in half.
  const denominator = limit || stats.usedTokens;
  const legend = segments.map((segment) => ({
    color: SEGMENT_COLORS[segment.id] ?? "#ffffff",
    glyph: USED_CELL,
    text:
      `${segment.label}: ${formatTokenCount(segment.tokens)} tokens ` +
      `(${percent(segment.tokens, denominator)})`,
  }));
  if (limit > 0) {
    legend.push({
      color: FREE_COLOR,
      glyph: FREE_CELL,
      text: `Free space: ${formatTokenCount(free)} (${percent(free, limit)})`,
    });
  }

  // Clip before colouring: slicing a string that already has ANSI escapes in it
  // cuts an escape in half and leaks the raw bytes onto the screen.
  const clip = (text: string): string =>
    text.length > width ? text.slice(0, width) : text;

  const lines: string[] = [];
  lines.push(chalk.bold(clip("Context Usage")));
  lines.push(
    chalk.dim(
      clip(
        `${stats.model ?? stats.provider} · ` +
          (limit > 0
            ? `${formatTokenCount(limit)} token context window`
            : "context window unknown — showing composition of what is used"),
      ),
    ),
  );
  lines.push("");

  // The grid is 20 cells wide either way; on a terminal too narrow for the
  // spaced-out form the cells pack tight rather than the grid being cropped —
  // a cropped grid would silently under-report whatever fell off the right.
  const spacedGrid = width >= INDENT + GRID_COLS * 2 - 1;
  const cellSeparator = spacedGrid ? " " : "";
  const gridWidth =
    INDENT + (spacedGrid ? GRID_COLS * 2 - 1 : GRID_COLS) + GUTTER;
  const legendWidth = width - gridWidth;
  const sideBySide = legendWidth >= MIN_LEGEND_WIDTH;

  const renderEntry = (
    entry: { color: string; glyph: string; text: string },
    maxWidth: number,
  ): string => {
    const color = chalk.hex(entry.color);
    const room = maxWidth - 2; // glyph + space
    const text = entry.text.length > room ? entry.text.slice(0, room) : entry.text;
    return `${color(entry.glyph)} ${text}`;
  };

  for (let row = 0; row < GRID_ROWS; row++) {
    const cellsInRow = glyphs.slice(row * GRID_COLS, (row + 1) * GRID_COLS);
    const entry = sideBySide ? legend[row] : undefined;
    const suffix = entry ? renderEntry(entry, legendWidth) : "";
    lines.push(
      `${" ".repeat(INDENT)}${cellsInRow.join(cellSeparator)}${" ".repeat(GUTTER)}${suffix}`.trimEnd(),
    );
  }
  // Anything the grid rows could not carry — more categories than rows, or a
  // terminal too narrow to sit them side by side — is listed underneath rather
  // than dropped. MCP tools are usually what lands in the tail.
  const overflow = sideBySide ? legend.slice(GRID_ROWS) : legend;
  if (overflow.length > 0) lines.push("");
  for (const entry of overflow) {
    lines.push(`${" ".repeat(INDENT)}${renderEntry(entry, width - INDENT)}`);
  }

  lines.push("");
  const notes = [
    `${stats.toolCount} tools` +
      (stats.mcpToolCount > 0 ? ` (${stats.mcpToolCount} from MCP)` : ""),
    `${stats.messageCount} messages`,
  ];
  if (stats.measuredInputTokens !== undefined) {
    notes.push(
      `last measured input ${formatTokenCount(stats.measuredInputTokens)}`,
    );
  }
  lines.push(chalk.dim(clip(`  ${notes.join(" · ")}`)));
  lines.push(
    chalk.dim(
      clip("  Sizes are estimated (~4 chars/token) and exclude image content."),
    ),
  );

  return lines;
}
