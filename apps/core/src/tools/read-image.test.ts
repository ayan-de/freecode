import assert from "node:assert/strict";
import test from "node:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { ReadTool } from "./read.js";

// 1x1 red PNG
const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "freecode-read-image-"));
const pngPath = path.join(tmp, "shot.png");
fs.writeFileSync(pngPath, Buffer.from(PNG_BASE64, "base64"));
const svgPath = path.join(tmp, "icon.svg");
fs.writeFileSync(svgPath, "<svg></svg>");

const ctx = {
  cwd: tmp,
  sessionId: "test",
  abort: new AbortController().signal,
};

test("read asImage: returns base64 data and media type in metadata", async () => {
  const res: any = await ReadTool.execute(
    { filePath: pngPath, asImage: true },
    ctx as any,
  );

  assert.equal(res.success, true);
  assert.equal(res.result.metadata.image.data, PNG_BASE64);
  assert.equal(res.result.metadata.image.mediaType, "image/png");
  // The base64 must never land in `output` — that string is re-sent as text
  // on every subsequent turn.
  assert.equal(res.result.output.includes(PNG_BASE64), false);
  assert.match(res.result.output, /shot\.png/);
});

test('read asImage: accepts the string "true" from providers that stringify booleans', async () => {
  const res: any = await ReadTool.execute(
    { filePath: pngPath, asImage: "true" as unknown as boolean },
    ctx as any,
  );

  assert.equal(res.success, true);
  assert.equal(res.result.metadata.image.mediaType, "image/png");
});

test("read asImage: rejects a non-boolean asImage at validation", () => {
  const result = ReadTool.validateInput?.({
    filePath: pngPath,
    asImage: "yes",
  });
  assert.equal(result?.valid, false);
});

test("read asImage: rejects SVG, which vision APIs do not accept", async () => {
  const res: any = await ReadTool.execute(
    { filePath: svgPath, asImage: true },
    ctx as any,
  );

  assert.equal(res.success, false);
  assert.match(res.error, /not a supported image format/);
});

test("read asImage: rejects a directory", async () => {
  const res: any = await ReadTool.execute(
    { filePath: tmp, asImage: true },
    ctx as any,
  );

  assert.equal(res.success, false);
  assert.match(res.error, /is a directory/);
});

test("read without asImage: still reads text normally", async () => {
  const res: any = await ReadTool.execute({ filePath: svgPath }, ctx as any);

  assert.equal(res.success, true);
  assert.equal(res.result.metadata?.image, undefined);
  assert.match(res.result.output, /svg/);
});
