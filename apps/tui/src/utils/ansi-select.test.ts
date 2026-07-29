import assert from "node:assert/strict";
import test from "node:test";
import chalk from "chalk";
import { displayWidth, plainText, highlightRange } from "./ansi-select.js";

test("displayWidth counts plain ascii", () => {
  assert.equal(displayWidth("hello"), 5);
});

test("displayWidth counts CJK as double-width", () => {
  assert.equal(displayWidth("你好"), 4);
});

test("displayWidth counts emoji as double-width", () => {
  assert.equal(displayWidth("🔥x"), 3);
});

test("plainText strips ANSI styling", () => {
  assert.equal(plainText(chalk.red("hi")), "hi");
});

test("highlightRange wraps a plain substring in reverse video", () => {
  const result = highlightRange("hello world", 6, 11);
  assert.equal(result, "hello \x1b[7mworld\x1b[27m");
});

test("highlightRange wraps a range inside already-styled text without corrupting escapes", () => {
  const styled = chalk.red("hello world");
  const result = highlightRange(styled, 0, 5);
  assert.equal(plainText(result), "hello world");
  assert.ok(result.includes("\x1b[7m"));
  assert.ok(result.includes("\x1b[27m"));
});

test("highlightRange clamps ranges beyond the line width", () => {
  const result = highlightRange("hi", 0, 100);
  assert.equal(plainText(result), "hi");
  assert.ok(result.startsWith("\x1b[7m"));
});

test("highlightRange handles wide characters without splitting a cell", () => {
  const result = highlightRange("你好", 0, 2);
  assert.equal(plainText(result), "你好");
  assert.ok(result.includes("你"));
});
