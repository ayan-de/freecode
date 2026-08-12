// =============================================================================
// Tests for renderCodeBlock — the markdown code-block highlighter that gives
// AI-supplied code samples a line-number gutter and Dracula syntax colors.
// =============================================================================
//
// Chalk auto-detects color support from the TTY/NO_COLOR/FORCE_COLOR env.
// node:test runs in a non-TTY pipe, so we set FORCE_COLOR before the dynamic
// import of diff-view (which transitively imports chalk). Setting it via a
// dynamic import is required because ESM hoists static `import` statements
// to the top of the module — env mutations at the top of the file run AFTER
// those imports, which is too late to affect chalk's level.
import test from "node:test";
import assert from "node:assert/strict";
import stripAnsi from "strip-ansi";

process.env.FORCE_COLOR = "1";
const { renderCodeBlock } = await import("./code-block.js");

// Default gutter shape: 3-wide right-aligned line number + dim vertical pipe.
const GUTTER_1 = "  1 │";
const GUTTER_2 = "  2 │";
const GUTTER_3 = "  3 │";
const GUTTER_10 = " 10 │"; // 2-digit line number → 1 leading space

test("renderCodeBlock: prefixes every line with a dim line-number gutter", () => {
  const lines = renderCodeBlock("const a = 1;\nconst b = 2;", "ts");
  assert.equal(lines.length, 2);
  const stripped = lines.map(stripAnsi);
  assert.ok(stripped[0].startsWith(GUTTER_1), `bad line 1 gutter: ${stripped[0]}`);
  assert.ok(stripped[1].startsWith(GUTTER_2), `bad line 2 gutter: ${stripped[1]}`);
});

test("renderCodeBlock: lines are 1-indexed and padded to width 3", () => {
  const code = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"].join("\n");
  const lines = renderCodeBlock(code, "ts");
  const stripped = lines.map(stripAnsi);
  assert.ok(stripped[0].startsWith(GUTTER_1));
  assert.ok(stripped[9].startsWith(GUTTER_10));
});

test("renderCodeBlock: highlights tokens for a known language", () => {
  // Use a line rich in tokenizable parts: `// hello world` is a TS comment
  // and cli-highlight emits SGR for it.
  const lines = renderCodeBlock("// hello world", "ts");
  const withAnsi = lines[0];
  const stripped = stripAnsi(withAnsi);
  assert.ok(stripped.includes("// hello world"), `missing code in: ${stripped}`);
  assert.ok(withAnsi.includes("\x1b["), "expected ANSI codes from cli-highlight");
});

test("renderCodeBlock: falls back to raw text when lang is unsupported", () => {
  // "klingon" isn't a real language; supportsLanguage returns false
  const lines = renderCodeBlock("hello world", "klingon");
  const stripped = stripAnsi(lines[0]);
  assert.ok(stripped.startsWith(GUTTER_1), `bad gutter: ${stripped}`);
  assert.ok(stripped.endsWith("hello world"));
});

test("renderCodeBlock: falls back to raw text when no lang is provided", () => {
  const lines = renderCodeBlock("plain text\nmore text");
  const stripped = lines.map(stripAnsi);
  assert.equal(stripped[0], `${GUTTER_1} plain text`);
  assert.equal(stripped[1], `${GUTTER_2} more text`);
});

test("renderCodeBlock: empty lines are still numbered and gutter-prefixed", () => {
  const lines = renderCodeBlock("a\n\nb", "ts");
  const stripped = lines.map(stripAnsi);
  assert.equal(stripped.length, 3);
  assert.equal(stripped[0], `${GUTTER_1} a`);
  assert.equal(stripped[1], `${GUTTER_2} `);
  assert.equal(stripped[2], `${GUTTER_3} b`);
});

test("renderCodeBlock: empty input returns one empty gutter line", () => {
  const lines = renderCodeBlock("", "ts");
  assert.equal(lines.length, 1);
  const stripped = stripAnsi(lines[0]);
  assert.ok(stripped.startsWith(GUTTER_1), `bad gutter: ${stripped}`);
});

test("renderCodeBlock: maps common Markdown lang aliases", () => {
  // Ensure each common alias doesn't trip the fallback path — we just want
  // a working gutter + no crash for any well-known lang tag.
  for (const lang of ["ts", "typescript", "js", "javascript", "py", "python", "go", "rs", "rust", "json"]) {
    const lines = renderCodeBlock("x = 1", lang);
    const withAnsi = lines[0];
    assert.ok(withAnsi.length > 0, `empty line for lang=${lang}`);
    assert.ok(stripAnsi(withAnsi).startsWith(GUTTER_1), `bad gutter for lang=${lang}`);
  }
});

test("renderCodeBlock: never throws on malformed input", () => {
  // Whitespace-only lines are the typical cli-highlight hazard. The
  // try/catch fallback must keep us alive.
  assert.doesNotThrow(() => renderCodeBlock("   \n\t\n   ", "ts"));
});

test("renderCodeBlock: gutter itself is dim-styled (ANSI)", () => {
  const lines = renderCodeBlock("x", "ts");
  // The gutter runs through chalk.dim — even on a single-char body the line
  // should still contain at least one ANSI SGR.
  assert.ok(lines[0].includes("\x1b["), `no ANSI in gutter line: ${JSON.stringify(lines[0])}`);
});
