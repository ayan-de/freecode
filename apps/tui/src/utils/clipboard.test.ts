import assert from "node:assert/strict";
import test from "node:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  buildClipboardImageScript,
  copyToClipboard,
  detectImageMediaType,
  encodePowerShellCommand,
  noClipboardImageMessage,
  readImageFromClipboard,
  OSC52_CAP_BASE64_BYTES,
} from "./clipboard.js";

test("copyToClipboard writes a bare OSC 52 sequence outside tmux", () => {
  const calls: string[] = [];
  const result = copyToClipboard("hello", {
    write: (s) => calls.push(s),
    env: {},
  });
  assert.deepEqual(result, { copied: "hello", truncated: false });
  const expected = `\x1b]52;c;${Buffer.from("hello").toString("base64")}\x07`;
  assert.equal(calls[0], expected);
});

test("copyToClipboard wraps the sequence for tmux passthrough, doubling the inner ESC", () => {
  const calls: string[] = [];
  copyToClipboard("hi", {
    write: (s) => calls.push(s),
    env: { TMUX: "/tmp/tmux-1000/default,123,0" },
  });
  const inner = `\x1b]52;c;${Buffer.from("hi").toString("base64")}\x07`;
  const expected = `\x1bPtmux;${inner.replace(/\x1b/g, "\x1b\x1b")}\x1b\\`;
  assert.equal(calls[0], expected);
});

test("copyToClipboard head-truncates text over the cap and reports truncation", () => {
  const calls: string[] = [];
  const big = "x".repeat(OSC52_CAP_BASE64_BYTES);
  const result = copyToClipboard(big, { write: (s) => calls.push(s), env: {} });
  assert.equal(result.truncated, true);
  assert.ok(result.copied.length < big.length);
  assert.ok(big.startsWith(result.copied));
  const sentBase64 = /c;([^\x07]+)\x07/.exec(calls[0])![1];
  assert.ok(sentBase64.length <= OSC52_CAP_BASE64_BYTES);
});

test("copyToClipboard does not truncate text under the cap", () => {
  const calls: string[] = [];
  const result = copyToClipboard("short text", {
    write: (s) => calls.push(s),
    env: {},
  });
  assert.equal(result.truncated, false);
  assert.equal(result.copied, "short text");
});

test("detectImageMediaType identifies the formats vision APIs accept", () => {
  const png = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0,
  ]);
  assert.equal(detectImageMediaType(png), "image/png");

  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]);
  assert.equal(detectImageMediaType(jpeg), "image/jpeg");

  const gif = Buffer.concat([Buffer.from("GIF89a", "ascii"), Buffer.alloc(4)]);
  assert.equal(detectImageMediaType(gif), "image/gif");

  const webp = Buffer.concat([
    Buffer.from("RIFF", "ascii"),
    Buffer.alloc(4),
    Buffer.from("WEBP", "ascii"),
  ]);
  assert.equal(detectImageMediaType(webp), "image/webp");
});

test("detectImageMediaType rejects non-images rather than guessing png", () => {
  // A WAV is also a RIFF container — checking only "RIFF" would call it webp.
  const wav = Buffer.concat([
    Buffer.from("RIFF", "ascii"),
    Buffer.alloc(4),
    Buffer.from("WAVE", "ascii"),
  ]);
  assert.equal(detectImageMediaType(wav), undefined);

  assert.equal(detectImageMediaType(Buffer.from("just some text")), undefined);
  assert.equal(detectImageMediaType(Buffer.alloc(0)), undefined);
  // Truncated PNG magic must not pass.
  assert.equal(
    detectImageMediaType(Buffer.from([0x89, 0x50, 0x4e])),
    undefined,
  );
});

test("the Windows script saves the clipboard image and fails when there is none", () => {
  const script = buildClipboardImageScript("C:\\Temp\\shot.png");
  assert.match(script, /Clipboard\]::GetImage\(\)/);
  // Without the guard, a null image would throw and look like a broken paste.
  assert.match(script, /if \(\$null -eq \$img\) \{ exit 1 \}/);
  assert.match(
    script,
    /\$img\.Save\('C:\\Temp\\shot\.png', \[System\.Drawing\.Imaging\.ImageFormat\]::Png\)/,
  );
});

test("the Windows script escapes an apostrophe in the temp path", () => {
  // C:\Users\O'Brien\AppData\Local\Temp is a real path shape; an unescaped
  // quote would end the string and turn the rest of the line into code.
  const script = buildClipboardImageScript("C:\\Users\\O'Brien\\shot.png");
  assert.match(script, /\$img\.Save\('C:\\Users\\O''Brien\\shot\.png',/);
});

test("encodePowerShellCommand emits base64 of UTF-16LE, as -EncodedCommand wants", () => {
  const encoded = encodePowerShellCommand("exit 1");
  assert.equal(Buffer.from(encoded, "base64").toString("utf16le"), "exit 1");
});

test("the empty-clipboard message only names install targets off Windows", () => {
  assert.equal(noClipboardImageMessage("win32"), "No image on the clipboard.");
  assert.match(noClipboardImageMessage("linux"), /wl-paste/);
  assert.match(noClipboardImageMessage("darwin"), /pngpaste/);
});

test("readImageFromClipboard returns image bytes unmangled, not utf8-decoded", async () => {
  // 1x1 red PNG — real binary, contains bytes that are invalid UTF-8.
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
    "base64",
  );

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "freecode-clip-"));
  const pngPath = path.join(dir, "t.png");
  fs.writeFileSync(pngPath, png);

  // Stand in for the clipboard tool: a shim named wl-paste that cats the PNG.
  const shim = path.join(dir, "wl-paste");
  fs.writeFileSync(shim, `#!/bin/sh\ncat ${pngPath}\n`);
  fs.chmodSync(shim, 0o755);

  const originalPath = process.env.PATH;
  // Prepend, don't replace: the shim itself shells out to `cat`.
  process.env.PATH = `${dir}:${originalPath}`;
  try {
    const result = await readImageFromClipboard();
    assert.ok(result, "expected an image from the clipboard shim");
    assert.equal(result.mediaType, "image/png");
    // The whole point: base64 must round-trip to the original bytes. A utf8
    // decode inflates 70 bytes to 86 via U+FFFD replacement.
    assert.equal(result.data, png.toString("base64"));
    assert.ok(Buffer.from(result.data, "base64").equals(png));
  } finally {
    process.env.PATH = originalPath;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
