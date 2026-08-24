import test from "node:test";
import assert from "node:assert/strict";
import { ScrollableModal } from "./scrollable-modal.js";

function plain(line: string): string {
  // eslint-disable-next-line no-control-regex
  return line.replace(/\x1b\[[0-9;]*m/g, "");
}

/** Content lines are numbered so a test can tell exactly which ones are shown. */
function numbered(count: number): (width: number) => string[] {
  return () => Array.from({ length: count }, (_, i) => `line-${i}`);
}

function build(contentRows: number, maxRows: number) {
  let closed = false;
  const modal = new ScrollableModal(
    "Test",
    numbered(contentRows),
    () => {
      closed = true;
    },
  );
  modal.setMaxRows(maxRows);
  return { modal, wasClosed: () => closed };
}

const KEY_DOWN = "\x1b[B";
const KEY_UP = "\x1b[A";
const KEY_ESC = "\x1b";

test("short content renders whole, with no scroll affordances", () => {
  const { modal } = build(4, 24);
  const text = modal.render(40).map(plain).join("\n");
  for (let i = 0; i < 4; i++) assert.ok(text.includes(`line-${i}`));
  assert.ok(!text.includes("more below"));
  assert.ok(text.includes("esc close"));
});

test("the card never exceeds the rows it was given", () => {
  // The whole reason this component exists: pi-tui's maxHeight clips the tail
  // silently, so the card has to fit itself rather than be cut.
  for (const maxRows of [10, 14, 24, 40]) {
    const { modal } = build(60, maxRows);
    assert.ok(
      modal.render(40).length <= maxRows,
      `card overflowed ${maxRows} rows`,
    );
  }
});

test("heightFor agrees with what render actually produces", () => {
  // The overlay's maxHeight is set from heightFor; a mismatch means pi-tui
  // clips rows the card thought it was drawing.
  for (const [content, maxRows] of [
    [4, 24],
    [60, 24],
    [60, 12],
  ] as const) {
    const { modal } = build(content, maxRows);
    assert.equal(modal.heightFor(40), modal.render(40).length);
  }
});

test("overflowing content is paged, not dropped", () => {
  const { modal } = build(60, 14);
  const first = modal.render(40).map(plain).join("\n");
  assert.ok(first.includes("line-0"));
  assert.ok(first.includes("more below"), "no indication content continues");
  assert.ok(!first.includes("line-59"));

  // Scroll to the end — the last line must be reachable.
  modal.handleInput("G");
  const last = modal.render(40).map(plain).join("\n");
  assert.ok(last.includes("line-59"), "the tail was unreachable");
  assert.ok(last.includes("more above"));
  assert.ok(!last.includes("more below"));
});

test("scrolling stops at both ends", () => {
  const { modal } = build(60, 14);
  modal.render(40);
  for (let i = 0; i < 200; i++) modal.handleInput(KEY_UP);
  assert.ok(modal.render(40).map(plain).join("\n").includes("line-0"));

  for (let i = 0; i < 500; i++) modal.handleInput(KEY_DOWN);
  const text = modal.render(40).map(plain).join("\n");
  assert.ok(text.includes("line-59"));
  // Scrolled past the end would show blank rows below the last line.
  assert.ok(!text.includes("more below"));
});

test("the body does not jump a row when scrolling starts", () => {
  // Indicator rows are reserved for the whole scroll, so the number of content
  // rows on screen stays constant — otherwise the grid shifts under the reader.
  const { modal } = build(60, 16);
  const countLines = (): number =>
    modal.render(40).map(plain).filter((l) => l.includes("line-")).length;
  const atTop = countLines();
  modal.handleInput(KEY_DOWN);
  assert.equal(countLines(), atTop);
  modal.handleInput("G");
  assert.equal(countLines(), atTop);
});

test("esc and q close, and nothing else does", () => {
  for (const key of [KEY_ESC, "q"]) {
    const { modal, wasClosed } = build(60, 14);
    modal.render(40);
    modal.handleInput(key);
    assert.ok(wasClosed(), `${JSON.stringify(key)} did not close the card`);
  }
  const { modal, wasClosed } = build(60, 14);
  modal.render(40);
  for (const key of [KEY_DOWN, KEY_UP, "g", "G", " "]) modal.handleInput(key);
  assert.ok(!wasClosed(), "a scroll key closed the card");
});

test("every row is exactly the requested width", () => {
  // A row that overruns breaks the overlay composite for the whole screen.
  for (const width of [40, 60, 90]) {
    const { modal } = build(60, 20);
    for (const line of modal.render(width)) {
      assert.equal(plain(line).length, width);
    }
  }
});

test("content wider than the card is clipped, not wrapped", () => {
  const modal = new ScrollableModal("Test", () => ["x".repeat(500)], () => {});
  modal.setMaxRows(24);
  const rows = modal.render(40);
  assert.equal(rows.length, modal.heightFor(40));
  for (const line of rows) assert.equal(plain(line).length, 40);
});

test("a resize while the card is open re-fits it", () => {
  // setMaxRows takes a supplier so the card re-reads the terminal height every
  // frame. Captured once, a shrink would put the tail back under pi-tui's
  // silent maxHeight clip — the exact bug this component exists to avoid.
  let rows = 40;
  const modal = new ScrollableModal("Test", numbered(60), () => {});
  modal.setMaxRows(() => rows);

  assert.ok(modal.render(40).length <= 40);
  rows = 12;
  assert.ok(
    modal.render(40).length <= 12,
    "card kept its old height after the terminal shrank",
  );
  rows = 40;
  assert.ok(modal.render(40).length <= 40);
});
