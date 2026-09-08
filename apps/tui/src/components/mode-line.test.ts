import test from "node:test";
import assert from "node:assert/strict";
import chalk from "chalk";
import { ModeLine } from "./mode-line.js";

// ModeLine paints through the DEFAULT chalk instance, which auto-detects and
// lands on level 0 under the test runner — themes.ts forces level 3 for its own
// instance, which is why a colour assertion here would otherwise only ever be
// matching the mode chip. Force it so the chip assertions test the real thing.
chalk.level = 3;

// \u001b escape rather than a literal ESC byte: a bare "[…m" pattern
// leaves the escape character behind and every width assertion is then off.
const ANSI = /\u001b\[[0-9;]*m/g;

function line(running: number, width = 100, agents = 0): string {
  const modeLine = new ModeLine(
    () => false,
    () => "build",
    () => "anthropic",
    () => "claude-opus-5",
    () => "high",
    () => running,
    () => agents,
  );
  return modeLine.render(width)[0];
}

const strip = (s: string): string => s.replace(ANSI, "");

test("shows a /shells chip with the running count, left of Effort", () => {
  const rendered = strip(line(2));
  assert.match(rendered, /\/shells \(2\)/);
  assert.ok(
    rendered.indexOf("/shells") < rendered.indexOf("Effort:"),
    "the chip belongs left of Effort",
  );
});

test("no chip when nothing is running", () => {
  // A permanent chip reading (0) is chrome, not information.
  assert.doesNotMatch(strip(line(0)), /\/shells/);
});

test("the chip is painted, not plain text", () => {
  // The point of the chip is that it is visible at a glance; if the background
  // escape ever gets dropped it degrades to unnoticeable dim text.
  assert.match(line(1), /\u001b\[48;2;255;215;0m/);
});

test("the chip is width-neutral: it never lengthens the line", () => {
  // The whole point of the width guard. Where the chip fits, the gap absorbs
  // it; where it does not, it is dropped. Either way the line measures the
  // same as it would with no chip at all — a line one column too long wraps
  // and pushes the input box off screen.
  //
  // Note this asserts equality with the chipless line, NOT equality with
  // `width`: ModeLine already overflows below ~76 columns on mode+model alone,
  // which is a pre-existing bug and not this change's to fix.
  for (const width of [70, 80, 90, 100, 120, 140]) {
    assert.equal(
      strip(line(3, width)).length,
      strip(line(0, width)).length,
      `chip changed the line length at ${width}`,
    );
  }
  // And at a width that does fit, that shared length is exactly the terminal.
  assert.equal(strip(line(3, 120)).length, 120);
});

test("the chip drops out rather than overflowing a narrow terminal", () => {
  // Mode and model are the line's job; the count is one keystroke away in
  // /shells, so on a terminal too narrow for both the chip is what yields.
  assert.doesNotMatch(strip(line(3, 80)), /\/shells/);
  assert.match(strip(line(3, 100)), /\/shells \(3\)/);
});

test("defaults to no chip when the count getter is not supplied", () => {
  // The parameter is optional so existing call sites keep compiling; they must
  // not start rendering a chip they never asked for.
  const modeLine = new ModeLine(
    () => false,
    () => "build",
    () => "anthropic",
    () => "claude-opus-5",
    () => "high",
  );
  assert.doesNotMatch(strip(modeLine.render(100)[0]), /\/shells/);
});

test("shows an /agents chip with the running subagent count", () => {
  const rendered = strip(line(0, 100, 3));
  assert.match(rendered, /\/agents \(3\)/);
  assert.ok(
    rendered.indexOf("/agents") < rendered.indexOf("Effort:"),
    "the chip belongs left of Effort",
  );
});

test("no /agents chip when nothing is delegating", () => {
  assert.doesNotMatch(strip(line(0, 100, 0)), /\/agents/);
});

test("the /agents chip is painted in its own colour, not the shells yellow", () => {
  assert.match(line(0, 100, 1), /\u001b\[48;2;95;215;255m/);
});

test("both chips fit together, agents outside shells", () => {
  const rendered = strip(line(2, 140, 3));
  assert.match(rendered, /\/agents \(3\)/);
  assert.match(rendered, /\/shells \(2\)/);
  assert.ok(
    rendered.indexOf("/agents") < rendered.indexOf("/shells"),
    "agents sits outside shells, which stays nearest Effort",
  );
});

test("neither chip lengthens the line, alone or together", () => {
  for (const width of [70, 80, 90, 100, 120, 140]) {
    const bare = strip(line(0, width, 0)).length;
    assert.equal(
      strip(line(0, width, 3)).length,
      bare,
      `agents chip at ${width}`,
    );
    assert.equal(
      strip(line(2, width, 3)).length,
      bare,
      `both chips at ${width}`,
    );
  }
});

test("under a squeeze the agents chip yields before the shells one", () => {
  // Budget is spent right-to-left, so the chip nearest Effort survives. Asserted
  // as an invariant over every width rather than at one magic column: the exact
  // threshold moves with the model name, the property must not.
  for (let width = 60; width <= 160; width++) {
    const rendered = strip(line(2, width, 3));
    if (rendered.includes("/agents")) {
      assert.ok(
        rendered.includes("/shells"),
        `at ${width} the agents chip survived a squeeze the shells chip did not`,
      );
    }
  }
  // And there is genuinely a width where only one of them fits, or the
  // assertion above is vacuous.
  const widths = [];
  for (let width = 60; width <= 160; width++) {
    const rendered = strip(line(2, width, 3));
    if (rendered.includes("/shells") && !rendered.includes("/agents")) {
      widths.push(width);
    }
  }
  assert.ok(
    widths.length > 0,
    "expected a width where only the shells chip fits",
  );
});

test("defaults to no /agents chip when the count getter is not supplied", () => {
  const modeLine = new ModeLine(
    () => false,
    () => "build",
    () => "anthropic",
    () => "claude-opus-5",
    () => "high",
    () => 1,
  );
  assert.doesNotMatch(strip(modeLine.render(120)[0]), /\/agents/);
});
