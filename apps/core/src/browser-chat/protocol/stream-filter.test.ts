import test from "node:test";
import assert from "node:assert/strict";
import { createStreamFilter } from "./stream-filter.js";

function drive(chunks: string[]): { visible: string; full: string } {
  const filter = createStreamFilter();
  let visible = "";
  for (const chunk of chunks) visible += filter.push(chunk);
  visible += filter.flush();
  return { visible, full: filter.full() };
}

test("plain prose streams through in full", () => {
  const { visible } = drive(["The bug is ", "in the retry logic."]);
  assert.equal(visible, "The bug is in the retry logic.");
});

test("a protocol block is suppressed, the prose before it is not", () => {
  const { visible } = drive([
    "Reading that file.\n\n",
    '~~~freecode\n{"calls":[]}\n~~~',
  ]);
  assert.equal(visible.trim(), "Reading that file.");
});

test("a fence split across chunks is never partially emitted", () => {
  // The case the hold-back window exists for: "~~" arrives, then "~freecode".
  const { visible } = drive(["Sure", "~~", '~freecode\n{"calls":[]}\n~~~']);
  assert.equal(visible, "Sure");
  assert.doesNotMatch(visible, /~/);
});

test("a bare {\"calls\" opening is suppressed too", () => {
  const { visible } = drive(['Okay. {"calls":[{"name":"ls","args":{}}]}']);
  assert.equal(visible.trim(), "Okay.");
});

test("full() keeps everything, including the suppressed block", () => {
  const { full } = drive(["Hi ", '~~~freecode\n{"calls":[]}\n~~~']);
  assert.match(full, /calls/);
});

test("nothing is emitted twice across pushes and flush", () => {
  const chunks = ["abcdefghij", "klmnopqrst"];
  const { visible, full } = drive(chunks);
  assert.equal(visible, full);
  assert.equal(visible, chunks.join(""));
});
