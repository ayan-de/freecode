import test from "node:test";
import assert from "node:assert/strict";
import { QuestionModal } from "./question-modal.js";

function plain(line: string): string {
  // eslint-disable-next-line no-control-regex
  return line.replace(/\x1b\[[0-9;]*m/g, "");
}

const OPTIONS = [
  { label: "Alpha", description: "first" },
  { label: "Beta", description: "second" },
];

const KEY_LEFT = "\x1b[D";
const KEY_RIGHT = "\x1b[C";
const KEY_ENTER = "\r";
const KEY_DOWN = "\x1b[B";

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
  // The "Other" row is selected but its editor stays closed: Enter opens it,
  // and the prefilled text is submitted as-is.
  modal.handleInput(KEY_ENTER);
  modal.handleInput(KEY_ENTER);
  assert.deepEqual(picked, ["something typed"]);
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
