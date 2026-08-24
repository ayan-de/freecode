import test from "node:test";
import assert from "node:assert/strict";
import { visibleWidth } from "@earendil-works/pi-tui";
import { CompactionModal } from "./compaction-modal.js";

// Every row is padded to the full overlay width; a row that is
// short or long corrupts the box, and an off-by-one in the bounce is the
// likely cause.
function assertRowsExactly(rows: string[], width: number, label: string) {
  for (const [i, row] of rows.entries()) {
    assert.equal(
      visibleWidth(row),
      width,
      `${label}: row ${i} is ${visibleWidth(row)} wide, expected ${width}`,
    );
  }
}

test("every frame of the sweep renders rows of exactly the overlay width", () => {
  const modal = new CompactionModal();
  for (const width of [24, 40, 46, 80]) {
    // A full bounce cycle and then some, so both directions and both
    // turning points are covered.
    for (let frame = 0; frame < 200; frame++) {
      assertRowsExactly(modal.render(width), width, `running w=${width}`);
      modal.tick();
    }
  }
});

test("terminal states render at the same width", () => {
  const done = new CompactionModal();
  done.complete(151_608, 38_200);
  assertRowsExactly(done.render(46), 46, "done");

  const skipped = new CompactionModal();
  skipped.fail("Nothing older than the last 2 turns yet.");
  assertRowsExactly(skipped.render(46), 46, "skipped");
});

test("completion reports the reduction, not just the new size", () => {
  const modal = new CompactionModal();
  modal.complete(151_608, 38_200);
  const text = modal.render(46).join("\n");
  assert.match(text, /151,608/);
  assert.match(text, /38,200/);
  assert.match(text, /75%/); // (151608-38200)/151608
});

test("a zero-token start does not divide by zero", () => {
  const modal = new CompactionModal();
  modal.complete(0, 0);
  const text = modal.render(46).join("\n");
  assert.match(text, /0%/);
  assert.doesNotMatch(text, /NaN/);
});
