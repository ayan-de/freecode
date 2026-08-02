import assert from "node:assert/strict";
import test from "node:test";
import chalk from "chalk";
import { CURSOR_MARKER, visibleWidth } from "@earendil-works/pi-tui";
import { sanitizeLine, sanitizeLines } from "./render-guard.js";

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
