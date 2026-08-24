import test from "node:test";
import assert from "node:assert/strict";
import { CURSOR_MARKER } from "@earendil-works/pi-tui";
import { QuestionModal } from "./question-modal.js";

function plain(line: string): string {
  return (
    line
      // eslint-disable-next-line no-control-regex
      .replace(/\x1b\[[0-9;]*m/g, "")
      // pi-tui's hardware-cursor marker: an APC sequence, zero visible width.
      .replaceAll(CURSOR_MARKER, "")
  );
}

const OPTIONS = [
  { label: "Alpha", description: "first" },
  { label: "Beta", description: "second" },
];

const KEY_LEFT = "\x1b[D";
const KEY_RIGHT = "\x1b[C";
const KEY_ENTER = "\r";
const KEY_DOWN = "\x1b[B";
const KEY_UP = "\x1b[A";
const KEY_ESC = "\x1b";

test("top border carries the question counter", () => {
  const modal = new QuestionModal("Approach", "Which one?", OPTIONS, {
    index: 1,
    total: 3,
  });
  const top = plain(modal.render(modal.width())[0]);
  assert.match(top, /\[2\/3\]─╮$/);
  assert.match(top, /^╭─ Approach ─/);
});

test("single question renders no counter", () => {
  const modal = new QuestionModal("Approach", "Which one?", OPTIONS);
  const top = plain(modal.render(modal.width())[0]);
  assert.ok(!top.includes("["), top);
  assert.match(top, /─╮$/);
});

test("every row is exactly the card width, counter or not", () => {
  for (const position of [undefined, { index: 9, total: 10 }]) {
    const modal = new QuestionModal("Approach", "Which one?", OPTIONS, position);
    const width = modal.width();
    for (const line of modal.render(width)) {
      assert.equal(plain(line).length, width, plain(line));
    }
  }
});

test("left/right report navigation only for multi-question requests", () => {
  const deltas: number[] = [];
  const multi = new QuestionModal("A", "q", OPTIONS, { index: 0, total: 2 });
  multi.onNavigate = (d) => deltas.push(d);
  multi.handleInput(KEY_LEFT);
  multi.handleInput(KEY_RIGHT);
  assert.deepEqual(deltas, [-1, 1]);

  const single = new QuestionModal("A", "q", OPTIONS);
  single.onNavigate = () => assert.fail("single question should not navigate");
  single.handleInput(KEY_LEFT);
  single.handleInput(KEY_RIGHT);
});

test("a previous answer is reselected when the question is revisited", () => {
  const picked: string[] = [];
  const modal = new QuestionModal("A", "q", OPTIONS, {
    index: 0,
    total: 2,
    previousAnswer: "Beta",
  });
  modal.onSelect = (label) => picked.push(label);
  modal.handleInput(KEY_ENTER);
  assert.deepEqual(picked, ["Beta"]);
});

test("free-text answers come back in the Other field", () => {
  const picked: string[] = [];
  const modal = new QuestionModal("A", "q", OPTIONS, {
    index: 0,
    total: 2,
    previousAnswer: "something typed",
  });
  modal.onSelect = (label) => picked.push(label);
  // The "Other" row is selected with its field already live, so Enter submits
  // the prefilled text as-is.
  modal.handleInput(KEY_ENTER);
  assert.deepEqual(picked, ["something typed"]);
});

test("landing on Other starts typing without an extra Enter", () => {
  const picked: string[] = [];
  const modal = new QuestionModal("A", "q", OPTIONS);
  modal.onSelect = (label) => picked.push(label);
  modal.handleInput(KEY_DOWN); // Beta
  modal.handleInput(KEY_DOWN); // Other — field is live from here
  for (const ch of "hi there") modal.handleInput(ch);
  modal.handleInput(KEY_ENTER);
  assert.deepEqual(picked, ["hi there"]);
});

test("digits are text in the Other field, not option jumps", () => {
  const picked: string[] = [];
  const modal = new QuestionModal("A", "q", OPTIONS);
  modal.onSelect = (label) => picked.push(label);
  modal.handleInput(KEY_DOWN);
  modal.handleInput(KEY_DOWN);
  modal.handleInput("2");
  modal.handleInput(KEY_ENTER);
  assert.deepEqual(picked, ["2"]);
});

test("up from Other closes the field and returns to the picker", () => {
  const picked: string[] = [];
  const modal = new QuestionModal("A", "q", OPTIONS);
  modal.onSelect = (label) => picked.push(label);
  modal.handleInput(KEY_DOWN);
  modal.handleInput(KEY_DOWN); // Other
  modal.handleInput("x");
  modal.handleInput(KEY_UP); // back to Beta
  modal.handleInput(KEY_ENTER);
  assert.deepEqual(picked, ["Beta"]);
});

test("Enter on an empty Other field does nothing", () => {
  const modal = new QuestionModal("A", "q", OPTIONS);
  modal.onSelect = () => assert.fail("must not answer with empty text");
  modal.onCancel = () => assert.fail("must not throw the question away");
  modal.handleInput(KEY_DOWN);
  modal.handleInput(KEY_DOWN); // Other
  modal.handleInput(KEY_ENTER);
});

test("Esc from the Other field cancels the question", () => {
  let cancelled = false;
  const modal = new QuestionModal("A", "q", OPTIONS);
  modal.onCancel = () => {
    cancelled = true;
  };
  modal.handleInput(KEY_DOWN);
  modal.handleInput(KEY_DOWN); // Other
  modal.handleInput(KEY_ESC);
  assert.equal(cancelled, true);
});

test("the Other row is replaced by the field, not stacked above it", () => {
  const modal = new QuestionModal("A", "q", OPTIONS);
  const picker = modal.render(modal.width()).map(plain).join("\n");
  assert.ok(picker.includes("Other"), picker);
  assert.ok(picker.includes("Type your own answer"), picker);

  modal.handleInput(KEY_DOWN);
  modal.handleInput(KEY_DOWN); // Other
  const editing = modal.render(modal.width()).map(plain).join("\n");
  assert.ok(!editing.includes("Other"), editing);
  assert.ok(!editing.includes("Type your own answer"), editing);
  assert.ok(editing.includes("type your answer…"), editing);
  // The other options stay put — only the "Other" row turns into the field.
  assert.ok(editing.includes("Alpha") && editing.includes("Beta"), editing);
});

test("a long Other answer wraps instead of running off the card", () => {
  const modal = new QuestionModal("A", "q", OPTIONS);
  modal.handleInput(KEY_DOWN);
  modal.handleInput(KEY_DOWN); // Other
  const typed = "wrap this fairly long free-text answer across several rows please";
  for (const ch of typed) modal.handleInput(ch);

  const width = modal.width();
  const lines = modal.render(width).map(plain);
  for (const line of lines) {
    assert.equal(line.length, width, line);
  }
  // Every word survives somewhere in the field rather than being truncated.
  const body = lines.join(" ");
  for (const word of typed.split(" ")) {
    assert.ok(body.includes(word), `missing "${word}" in:\n${lines.join("\n")}`);
  }
});

test("navigation keys do not disturb the option cursor", () => {
  const picked: string[] = [];
  const modal = new QuestionModal("A", "q", OPTIONS, { index: 0, total: 2 });
  modal.onNavigate = () => {};
  modal.onSelect = (label) => picked.push(label);
  modal.handleInput(KEY_DOWN);
  modal.handleInput(KEY_LEFT);
  modal.handleInput(KEY_ENTER);
  assert.deepEqual(picked, ["Beta"]);
});
