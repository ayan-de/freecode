import test from "node:test";
import assert from "node:assert/strict";
import { classifyCommand, maybeCompressOutput } from "./output-compress.js";
import { MAX_MODEL_OUTPUT_CHARS } from "./output-store/config.js";

function withFlag<T>(value: string | undefined, fn: () => T): T {
  const prev = process.env.FREECODE_BASH_COMPRESS;
  if (value === undefined) delete process.env.FREECODE_BASH_COMPRESS;
  else process.env.FREECODE_BASH_COMPRESS = value;
  try {
    return fn();
  } finally {
    if (prev === undefined) delete process.env.FREECODE_BASH_COMPRESS;
    else process.env.FREECODE_BASH_COMPRESS = prev;
  }
}

test("classifyCommand: the output's shape, not the command's first word", () => {
  assert.equal(classifyCommand("git diff HEAD~1"), "source");
  assert.equal(classifyCommand("cat package.json"), "source");
  assert.equal(classifyCommand("grep -rn foo src/"), "search");
  assert.equal(classifyCommand("npm test"), "log");
  assert.equal(classifyCommand("pnpm install"), "log");
  // A pipeline is classified by its LAST segment: this emits search results.
  assert.equal(classifyCommand("npm test | grep FAIL"), "search");
  // Quoting plus a pipe makes the split unsafe — leave unclassified.
  assert.equal(classifyCommand(`awk '{ print $1 "|" $2 }' f`), "other");
  assert.equal(classifyCommand("echo hi"), "other");
});

// Big enough to clear the compression threshold.
const FILLER = "installed dep-" ;
function bigLog(): string {
  const lines: string[] = [];
  lines.push("=== build start ===");
  for (let i = 0; i < 40; i++) lines.push(`head line ${i}`);
  for (let i = 0; i < 2000; i++) lines.push(`${FILLER}${i} in 3ms`);
  lines.push("ERROR: widget.ts failed to compile");
  for (let i = 0; i < 2000; i++) lines.push(`copied asset-${i}`);
  for (let i = 0; i < 60; i++) lines.push(`tail line ${i}`);
  return lines.join("\n");
}

test("flag off: output passes through untouched", () => {
  const log = bigLog();
  assert.equal(withFlag(undefined, () => maybeCompressOutput(log, "log", "id1")), log);
  assert.equal(withFlag("0", () => maybeCompressOutput(log, "log", "id1")), log);
});

test("under the size threshold nothing is compressed", () => {
  const small = "line a\nline a\nline a\nline a\n";
  assert.ok(small.length < MAX_MODEL_OUTPUT_CHARS);
  assert.equal(withFlag("1", () => maybeCompressOutput(small, "log", "id1")), small);
});

test("source output is never compressed, whatever the size", () => {
  const diff = "+x\n".repeat(MAX_MODEL_OUTPUT_CHARS);
  assert.equal(withFlag("1", () => maybeCompressOutput(diff, "source", "id1")), diff);
});

test("log compression keeps head, tail and failure lines; elision names the handle", () => {
  const log = bigLog();
  const out = withFlag("1", () => maybeCompressOutput(log, "log", "call-7"));
  assert.ok(out.length < log.length);
  assert.ok(out.includes("=== build start ==="));
  assert.ok(out.includes("tail line 59"));
  // The failure line buried mid-log survives — the whole point.
  assert.ok(out.includes("ERROR: widget.ts failed to compile"));
  assert.ok(out.includes('id="call-7"'));
});

test("search compression never drops a distinct line", () => {
  const distinct: string[] = [];
  for (let i = 0; i < 4000; i++) distinct.push(`src/f${i}.ts:1:match here`);
  // Interleave a run of duplicates to give it something to collapse.
  const input = [...distinct.slice(0, 2000), ...Array(500).fill("Binary file x matches"), ...distinct.slice(2000)].join("\n");
  const out = withFlag("1", () => maybeCompressOutput(input, "search", "id1"));
  assert.ok(out.length < input.length);
  for (const line of distinct) assert.ok(out.includes(line), line);
  assert.match(out, /repeated 499 more times/);
});

test("compression that does not help is not applied", () => {
  // All-distinct log lines with nothing failure-like: head+tail elision still
  // shrinks it, but an all-distinct SEARCH result cannot shrink at all.
  const input = Array.from({ length: 4000 }, (_, i) => `src/g${i}.ts:2:hit`).join("\n");
  const out = withFlag("1", () => maybeCompressOutput(input, "search", "id1"));
  assert.equal(out, input);
});
