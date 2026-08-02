import test from "node:test";
import assert from "node:assert/strict";
import { visibleWidth } from "@earendil-works/pi-tui";
import type {
  SerializedMessage,
  SessionMeta,
} from "@thisisayande/freecode-shared";
import { ResumePicker } from "./resume-picker.js";

const WIDTH = 100;
// `render` derives the list column width from the card width, and the card
// spans the full width it is given; mirror that here so the tests can aim the
// wheel at a specific pane.
const LIST_WIDTH = Math.max(20, Math.floor((Math.max(40, WIDTH) - 2) * 0.38));
const OVER_LIST = 1;
const OVER_PREVIEW = LIST_WIDTH + 2;

function makeSessions(n: number): SessionMeta[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `s${i}`,
    title: `Session ${i}`,
    projectPath: "/tmp/project",
    provider: "anthropic",
    status: "active" as const,
    createdAt: 1,
    updatedAt: 1,
    lastTurnAt: 1,
    turnCount: 3,
  }));
}

/** A transcript long enough that the preview pane definitely overflows. */
function longTranscript(): SerializedMessage[] {
  return Array.from({ length: 40 }, (_, i) => ({
    id: `m${i}`,
    role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
    timestamp: 1,
    parts: [{ type: "text" as const, content: `line ${i} `.repeat(20) }],
  }));
}

/**
 * Walk a rendered row and report the 256-colour background active at each
 * visible column (null = terminal default). A row that resets mid-line leaves
 * its padding on the default background, which is invisible to a width
 * assertion but shows up as a highlight band that stops at the text.
 */
function backgroundPerColumn(row: string): (number | null)[] {
  const out: (number | null)[] = [];
  let bg: number | null = null;
  for (let i = 0; i < row.length; i++) {
    if (row[i] === "" && row[i + 1] === "[") {
      const end = row.indexOf("m", i);
      if (end === -1) break;
      const params = row.slice(i + 2, end).split(";");
      if (params.includes("0") || params[0] === "") bg = null;
      const at = params.indexOf("48");
      if (at !== -1 && params[at + 1] === "5") bg = Number(params[at + 2]);
      i = end;
      continue;
    }
    out.push(bg);
  }
  return out;
}

test("every card row is the same width at any terminal size", () => {
  // A row that is wider than its neighbours pushes its right-hand `│` past the
  // card edge, which shows up as a border segment out of line with the rest.
  for (const w of [30, 40, 46, 60, 100, 200]) {
    const picker = new ResumePicker(makeSessions(4), {
      onSelect: () => {},
      onCancel: () => {},
    });
    const frame = picker.render(w);
    const widths = frame.map(visibleWidth);
    const distinct = [...new Set(widths)];
    assert.equal(
      distinct.length,
      1,
      `width=${w}: rows ${widths
        .map((v, i) => (v === widths[0] ? null : `${i}:${v}`))
        .filter(Boolean)
        .join(", ")} differ from ${widths[0]}`,
    );
  }
});

test("every row of a session spans the list column with one background", () => {
  const picker = new ResumePicker(makeSessions(4), {
    onSelect: () => {},
    onCancel: () => {},
  });
  const frame = picker.render(WIDTH);

  // Row 0 = top border, 1 = blank, 2 = title; the list starts at row 3, and
  // the cursor sits on the first session, so rows 3..7 are the selected entry
  // and rows 8..12 are the next (unselected) one.
  for (const [label, rows, expected] of [
    ["selected", [3, 4, 5, 6, 7], 60],
    ["unselected", [8, 9, 10, 11, 12], 236],
  ] as const) {
    for (const r of rows) {
      const bg = backgroundPerColumn(frame[r]);
      // Column 0 is the card border and the list occupies 1..LIST_WIDTH, whose
      // last column is the scrollbar gutter (always the card background, so
      // the track reads as a gutter rather than part of the row).
      const cols = bg.slice(1, LIST_WIDTH);
      assert.equal(
        cols.length,
        LIST_WIDTH - 1,
        `${label} row ${r} is only ${cols.length} columns wide`,
      );
      assert.equal(bg[LIST_WIDTH], 236, `${label} row ${r}: gutter background`);
      const wrong = cols.findIndex((c) => c !== expected);
      assert.equal(
        wrong,
        -1,
        `${label} row ${r}: background ends at column ${wrong} ` +
          `(got ${cols[wrong]}, expected ${expected}) — the row must stay on ` +
          `one background for the full column`,
      );
    }
  }
});

test("wheel over the list column moves the cursor and clamps at both ends", () => {
  const selected: string[] = [];
  const picker = new ResumePicker(makeSessions(5), {
    onSelectionChange: (id) => selected.push(id),
    onSelect: () => {},
    onCancel: () => {},
  });
  picker.render(WIDTH); // caches the geometry the wheel handler hit-tests against

  picker.handleMouseWheel(1, OVER_LIST);
  assert.equal(picker.selectedId(), "s1");
  picker.handleMouseWheel(1, OVER_LIST);
  assert.equal(picker.selectedId(), "s2");
  assert.deepEqual(selected, ["s1", "s2"]);

  // Wheel up past the top clamps rather than wrapping to the last session.
  for (let i = 0; i < 10; i++) picker.handleMouseWheel(-1, OVER_LIST);
  assert.equal(picker.selectedId(), "s0");

  // ...and likewise at the bottom.
  for (let i = 0; i < 20; i++) picker.handleMouseWheel(1, OVER_LIST);
  assert.equal(picker.selectedId(), "s4");
});

test("wheel over the preview column scrolls the preview, not the cursor", () => {
  const picker = new ResumePicker(makeSessions(3), {
    onSelect: () => {},
    onCancel: () => {},
  });
  picker.setPreview("s0", longTranscript());
  // Capture the baseline *after* a no-op wheel-up, so the footer hint (which
  // differs per focused pane) matches the frames compared against it below.
  picker.render(WIDTH);
  picker.handleMouseWheel(-1, OVER_PREVIEW);
  const before = picker.render(WIDTH);

  picker.handleMouseWheel(1, OVER_PREVIEW);
  const after = picker.render(WIDTH);

  assert.equal(picker.selectedId(), "s0", "cursor must not move");
  assert.notDeepEqual(after, before, "preview should have scrolled");

  // Scrolling up past the top clamps back to the original frame.
  for (let i = 0; i < 10; i++) picker.handleMouseWheel(-1, OVER_PREVIEW);
  assert.deepEqual(picker.render(WIDTH), before);
});

test("wheel focus follows the pane under the pointer", () => {
  const picker = new ResumePicker(makeSessions(3), {
    onSelect: () => {},
    onCancel: () => {},
  });
  picker.render(WIDTH);

  picker.handleMouseWheel(1, OVER_PREVIEW);
  assert.equal(picker.isPreviewFocused(), true);
  picker.handleMouseWheel(1, OVER_LIST);
  assert.equal(picker.isPreviewFocused(), false);
});
