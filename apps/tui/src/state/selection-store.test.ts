import assert from "node:assert/strict";
import test from "node:test";
import { SelectionStore, normalize } from "./selection-store.js";

test("SelectionStore starts empty", () => {
  assert.equal(new SelectionStore().get(), null);
});

test("SelectionStore begin + update tracks anchor and cursor", () => {
  const s = new SelectionStore();
  s.begin({ lineIndex: 2, column: 3 });
  s.update({ lineIndex: 4, column: 1 });
  assert.deepEqual(s.get(), {
    anchor: { lineIndex: 2, column: 3 },
    cursor: { lineIndex: 4, column: 1 },
  });
});

test("SelectionStore clear resets to null", () => {
  const s = new SelectionStore();
  s.begin({ lineIndex: 0, column: 0 });
  s.clear();
  assert.equal(s.get(), null);
});

test("SelectionStore detects a near-zero drag as a plain click", () => {
  const s = new SelectionStore();
  assert.equal(s.isNearZeroDrag({ lineIndex: 1, column: 5 }, { lineIndex: 1, column: 5 }), true);
  assert.equal(s.isNearZeroDrag({ lineIndex: 1, column: 5 }, { lineIndex: 2, column: 5 }), false);
});

test("normalize orders a reversed selection (dragged upward)", () => {
  const n = normalize({
    anchor: { lineIndex: 5, column: 2 },
    cursor: { lineIndex: 3, column: 8 },
  });
  assert.deepEqual(n, { startLine: 3, startCol: 8, endLine: 5, endCol: 2 });
});

test("normalize orders a same-line reversed selection by column", () => {
  const n = normalize({
    anchor: { lineIndex: 2, column: 9 },
    cursor: { lineIndex: 2, column: 1 },
  });
  assert.deepEqual(n, { startLine: 2, startCol: 1, endLine: 2, endCol: 9 });
});
