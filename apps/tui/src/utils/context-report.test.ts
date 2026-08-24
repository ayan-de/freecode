import test from "node:test";
import assert from "node:assert/strict";
import type { ContextBreakdown } from "@thisisayande/freecode-shared";
import { allocateCells, renderContextReport } from "./context-report.js";

/** Strip ANSI so assertions are about layout, not colour codes. */
function plain(line: string): string {
  // eslint-disable-next-line no-control-regex
  return line.replace(/\x1b\[[0-9;]*m/g, "");
}

/**
 * Cells in the grid proper. The legend shares the grid's lines when the
 * terminal is wide, so count only the columns the grid occupies: 2 of indent
 * plus 20 cells separated by a space.
 */
const GRID_COLUMNS = 2 + 20 * 2 - 1;

function countCells(lines: string[]): number {
  return lines
    .map((line) => plain(line).slice(0, GRID_COLUMNS))
    .join("")
    .split("")
    .filter((c) => c === "⛁" || c === "⛶").length;
}

const stats: ContextBreakdown = {
  provider: "anthropic",
  model: "claude-opus-5",
  contextLimit: 1_000_000,
  segments: [
    { id: "system-prompt", label: "System prompt", tokens: 3400 },
    { id: "skills", label: "Skills", tokens: 9900 },
    { id: "memories", label: "Memories", tokens: 11300 },
    { id: "messages", label: "Messages", tokens: 1100 },
  ],
  usedTokens: 25700,
  freeTokens: 974300,
  measuredInputTokens: 26120,
  toolCount: 15,
  mcpToolCount: 2,
  messageCount: 4,
};

test("cell allocation always sums to the grid size", () => {
  for (const weights of [
    [1, 1, 1],
    [999_000, 500, 300, 200],
    [7],
    [50, 50],
  ]) {
    const counts = allocateCells(weights, 200);
    assert.equal(
      counts.reduce((a, b) => a + b, 0),
      200,
      `weights ${JSON.stringify(weights)} did not fill the grid`,
    );
  }
});

test("a tiny but non-zero segment still gets a cell", () => {
  // 1 token against a 1M window rounds to zero cells. Showing nothing for a
  // category that is present reads as "not loaded", which is a different claim.
  const counts = allocateCells([1_000_000, 1], 200);
  assert.equal(counts[1], 1);
  assert.equal(counts[0], 199);
});

test("a zero-token segment gets no cell", () => {
  assert.deepEqual(allocateCells([100, 0, 100], 200), [100, 0, 100]);
});

test("allocation is a no-op when there is nothing to allocate", () => {
  assert.deepEqual(allocateCells([0, 0], 200), [0, 0]);
});

test("the rendered grid is always a full 20x10", () => {
  assert.equal(countCells(renderContextReport(stats, 120)), 200);
  // A brand-new session with no measurable content must still draw the grid.
  assert.equal(
    countCells(
      renderContextReport({ ...stats, segments: [], usedTokens: 0 }, 120),
    ),
    200,
  );
});

test("every category and free space appear in the legend", () => {
  const text = renderContextReport(stats, 120).map(plain).join("\n");
  for (const label of ["System prompt", "Skills", "Memories", "Messages"]) {
    assert.ok(text.includes(label), `missing legend entry: ${label}`);
  }
  assert.ok(text.includes("Free space"));
  assert.ok(text.includes("1.0M token context window"));
});

test("no line overflows the terminal width", () => {
  for (const width of [40, 60, 80, 120]) {
    for (const line of renderContextReport(stats, width)) {
      assert.ok(
        plain(line).length <= width,
        `line of ${plain(line).length} cols exceeded width ${width}: ${plain(line)}`,
      );
    }
  }
});

test("a narrow terminal stacks the legend under the grid", () => {
  const lines = renderContextReport(stats, 50).map(plain);
  // Grid rows carry 20 cells; legend rows carry exactly one (their bullet).
  const gridRows = lines.filter(
    (l) => l.split("").filter((c) => c === "⛁" || c === "⛶").length > 1,
  );
  assert.equal(gridRows.length, 10);
  // Stacked, so no grid row carries a trailing legend label.
  assert.equal(
    gridRows.filter((l) => l.includes(":")).length,
    0,
  );
  assert.ok(lines.join("\n").includes("Free space"));
});

test("an unknown context limit reports composition instead of occupancy", () => {
  const text = renderContextReport(
    { ...stats, contextLimit: undefined, freeTokens: undefined },
    120,
  )
    .map(plain)
    .join("\n");
  assert.ok(text.includes("context window unknown"));
  assert.ok(!text.includes("Free space"));
});
