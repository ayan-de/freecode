import assert from "node:assert/strict";
import test from "node:test";
import chalk from "chalk";
import {
  CURSOR_MARKER,
  visibleWidth,
  type Component,
  type Terminal,
} from "@earendil-works/pi-tui";
import { sanitizeLine, sanitizeLines, SafeTUI } from "./render-guard.js";

const ESC = "\x1b";

test("an embedded newline is flattened onto one row", () => {
  const out = sanitizeLine("Run(node -e '\nconst x = 1;\n')", 80);
  assert.ok(!out.includes("\n"));
  assert.equal(out, "Run(node -e ' const x = 1; ')");
});

test("a carriage return is neutralised", () => {
  const out = sanitizeLine("downloading 50%\rdownloading 100%", 80);
  assert.ok(!out.includes("\r"));
  assert.equal(out, "downloading 50% downloading 100%");
});

test("lines wider than the terminal are clipped", () => {
  const out = sanitizeLine("x".repeat(200), 40);
  assert.equal(visibleWidth(out), 40);
});

// Built by hand rather than via chalk: chalk strips colour when stdout is not
// a TTY, which it isn't under the test runner.
test("ANSI styling survives sanitising", () => {
  const styled = `${ESC}[31merror${ESC}[0m ${ESC}[2m(2ms)${ESC}[0m`;
  const out = sanitizeLine(styled, 80);
  assert.equal(out, styled);
});

test("ANSI styling survives clipping", () => {
  const styled = `${ESC}[31m${"x".repeat(200)}${ESC}[0m`;
  const out = sanitizeLine(styled, 40);
  assert.equal(visibleWidth(out), 40);
  assert.ok(out.includes(`${ESC}[31m`));
});

test("pi-tui's cursor marker is preserved", () => {
  const line = `> some text${CURSOR_MARKER}`;
  assert.equal(sanitizeLine(line, 80), line);
});

test("tabs are left for pi-tui to expand", () => {
  const line = "col1\tcol2";
  assert.equal(sanitizeLine(line, 80), line);
});

test("wide characters are not split mid-cell when clipping", () => {
  const out = sanitizeLine("日本語".repeat(20), 41);
  assert.ok(visibleWidth(out) <= 41);
});

// The TUI constructor only stores the terminal; render()/renderChild() never
// touch it, so a bare stub is enough to exercise the frame memo.
const fakeTerminal = { columns: 80, rows: 24 } as unknown as Terminal;

function countingComponent(lines: string[]): Component & { renders: number } {
  return {
    renders: 0,
    render(this: { renders: number }, _width: number): string[] {
      this.renders++;
      return lines;
    },
    invalidate(): void {},
  } as Component & { renders: number };
}

test("renderChild memoizes within a frame and re-renders on the next", () => {
  const tui = new SafeTUI(fakeTerminal);
  const comp = countingComponent(["row"]);
  tui.addChild(comp);

  const frame1 = tui.render(80);
  assert.deepEqual(frame1, ["row"]);
  assert.equal(comp.renders, 1);

  // A layout callback measuring the same component in the same frame reuses
  // the tree pass's lines instead of re-running render.
  assert.equal(tui.renderChild(comp, 80).length, 1);
  assert.equal(comp.renders, 1);

  // A different width is a real render (overlays measure at their own width).
  tui.renderChild(comp, 40);
  assert.equal(comp.renders, 2);

  // The next frame renders fresh.
  tui.render(80);
  assert.equal(comp.renders, 3);
});

test("frame stats track cost and memo traffic", () => {
  const tui = new SafeTUI(fakeTerminal);
  tui.addChild(countingComponent(["a"]));
  tui.render(80);
  tui.render(80);
  assert.equal(tui.stats.frames, 2);
  assert.ok(tui.stats.lastMs >= 0);
  assert.ok(tui.stats.avgMs >= 0);
  // Two frames = two tree-pass misses, no external measurers in this test.
  assert.equal(tui.stats.memoMisses, 2);
});

test("sanitizeLines guarantees the one-line-per-row invariant", () => {
  const lines = sanitizeLines(
    [
      "plain",
      "with\nnewline",
      "with\rreturn",
      "way too wide ".repeat(20),
      chalk.green("styled"),
    ],
    30,
  );
  for (const line of lines) {
    assert.ok(!/[\n\r]/.test(line), `cursor-moving control in: ${line}`);
    assert.ok(visibleWidth(line) <= 30, `too wide: ${visibleWidth(line)}`);
  }
});
