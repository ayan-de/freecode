import assert from "node:assert/strict";
import test from "node:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { ReadTool } from "./read.js";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "freecode-read-"));

const ctx = {
  cwd: tmp,
  sessionId: "test-read",
  abort: new AbortController().signal,
};

function write(name: string, content: string): string {
  const p = path.join(tmp, name);
  fs.writeFileSync(p, content);
  return p;
}

async function read(filePath: string, params: Record<string, unknown> = {}) {
  return (await ReadTool.execute({ filePath, ...params }, ctx as any)) as any;
}

test("line numbers prefix every line by default", async () => {
  const res = await read(write("numbered.txt", "alpha\nbeta"));

  assert.equal(res.success, true);
  assert.match(res.result.output, /1: alpha/);
  assert.match(res.result.output, /2: beta/);
});

test("FREECODE_READ_LINE_NUMBERS=0 drops the prefix, keeps the range footer", async () => {
  // Spec 2026-09-04-harness-cost-efficiency.md D3: the experiment variant.
  // Offset paging lives in the footer, not the prefix, so it must survive.
  const prev = process.env.FREECODE_READ_LINE_NUMBERS;
  process.env.FREECODE_READ_LINE_NUMBERS = "0";
  try {
    const res = await read(write("plain.txt", "alpha\nbeta\ngamma"));

    assert.equal(res.success, true);
    assert.ok(res.result.output.includes("alpha\nbeta\ngamma"));
    assert.equal(/^\d+: /m.test(res.result.output), false);
    assert.match(res.result.output, /End of file - total 3 lines/);
  } finally {
    if (prev === undefined) delete process.env.FREECODE_READ_LINE_NUMBERS;
    else process.env.FREECODE_READ_LINE_NUMBERS = prev;
  }
});

test("a single overlong line is truncated, not the whole file", async () => {
  const res = await read(write("minified.js", "x".repeat(5_000)));

  assert.equal(res.success, true);
  assert.match(res.result.output, /line truncated to 2000 chars/);
  // 2000 kept + the suffix, not all 5000.
  assert.equal(res.result.output.includes("x".repeat(2_001)), false);
});

test("the byte cap stops the read and reports the resume offset", async () => {
  // 100-char lines: 50 KB binds at ~506 lines, well before the 2000-line limit.
  const lines = Array.from({ length: 600 }, () => "y".repeat(100));
  const res = await read(write("big.txt", lines.join("\n")));

  assert.equal(res.success, true);
  assert.match(res.result.output, /Output capped at 50 KB/);

  const [, last, next] = res.result.output.match(
    /Showing lines 1-(\d+)\. Use offset=(\d+) to continue/,
  )!;
  assert.ok(Number(last) < 600, "stopped before the end of the file");
  assert.equal(Number(next), Number(last) + 1);
  // Cut on a line boundary: the last emitted line is whole.
  assert.match(res.result.output, new RegExp(`\\n${last}: y{100}\\n`));
});

test("hitting the line limit is not reported as a byte cap", async () => {
  // 2500 one-char lines is ~5 KB — nowhere near 50 KB, but it does exhaust the
  // default 2000-line limit. Regression: `cut` used to conflate the two.
  const res = await read(
    write("many-lines.txt", Array.from({ length: 2_500 }, () => "z").join("\n")),
  );

  assert.equal(res.success, true);
  assert.equal(res.result.output.includes("Output capped at"), false);
  assert.match(res.result.output, /Showing lines 1-2000 of 2500/);
});

test("a small file reports end-of-file with no truncation notice", async () => {
  const res = await read(
    write("small.txt", Array.from({ length: 20 }, (_, i) => `l${i}`).join("\n")),
  );

  assert.equal(res.success, true);
  assert.equal(res.result.output.includes("Output capped at"), false);
  assert.equal(res.result.output.includes("Use offset="), false);
  assert.match(res.result.output, /End of file - total 20 lines/);
});

test("offset/limit read exactly the requested window", async () => {
  const p = write(
    "ranged.txt",
    Array.from({ length: 500 }, (_, i) => `line${i + 1}`).join("\n"),
  );
  const res = await read(p, { offset: 340, limit: 3 });

  assert.equal(res.success, true);
  assert.match(res.result.output, /340: line340/);
  assert.match(res.result.output, /342: line342/);
  assert.equal(res.result.output.includes("343: line343"), false);
  assert.equal(res.result.output.includes("339: line339"), false);
  assert.match(res.result.output, /Showing lines 340-342 of 500/);
});

test("offset and limit accept numeric strings from stringifying providers", async () => {
  const p = write(
    "coerce.txt",
    Array.from({ length: 50 }, (_, i) => `n${i + 1}`).join("\n"),
  );
  const res = await read(p, { offset: "10", limit: "2" });

  assert.equal(res.success, true);
  assert.match(res.result.output, /10: n10\n11: n11/);
});

test("offset below 1 is rejected rather than silently clamped", () => {
  for (const bad of [0, -5, 1.5]) {
    const v = ReadTool.validateInput!({ filePath: "/x", offset: bad }) as any;
    assert.equal(v.valid, false, `offset=${bad} should be rejected`);
    assert.match(v.error, /offset must be a whole number >= 1/);
  }
  assert.equal(
    (ReadTool.validateInput!({ filePath: "/x", offset: 1 }) as any).valid,
    true,
  );
});

test("limit below 1 is rejected", () => {
  const v = ReadTool.validateInput!({ filePath: "/x", limit: 0 }) as any;
  assert.equal(v.valid, false);
  assert.match(v.error, /limit must be a whole number >= 1/);
});

test("offset 0 does not read off the front of the file", async () => {
  // validate() rejects this, but execute() is reachable directly and used to
  // index allLines[-1] and throw.
  const p = write("clamp.txt", "a\nb\nc");
  const res = await read(p, { offset: 0 });

  assert.equal(res.success, true);
  assert.match(res.result.output, /1: a/);
});

test("an offset past the end says so instead of claiming end-of-file", async () => {
  const res = await read(write("short.txt", "a\nb\nc"), { offset: 900 });

  assert.equal(res.success, true);
  assert.match(res.result.output, /offset 900 is past the end/);
  assert.match(res.result.output, /which has 3 lines/);
  assert.equal(res.result.output.includes("End of file"), false);
});

test("a file over the size guard is refused before it is loaded", async () => {
  const p = path.join(tmp, "huge.log");
  fs.writeFileSync(p, "");
  fs.truncateSync(p, 11 * 1024 * 1024); // sparse; never actually allocated

  const res = await read(p);

  assert.equal(res.success, false);
  assert.match(res.error, /too large \(11\.0MB\)/);
  assert.match(res.error, /Maximum size is 10MB/);
});
