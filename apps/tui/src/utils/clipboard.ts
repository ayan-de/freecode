/** Historical safe ceiling for OSC 52 payloads across common terminals. */
export const OSC52_CAP_BASE64_BYTES = 100 * 1024;

/** Max image size for clipboard (10MB) */
export const MAX_CLIPBOARD_IMAGE_SIZE = 10 * 1024 * 1024;

export interface CopyResult {
  copied: string;
  truncated: boolean;
}

export interface CopyOptions {
  write?: (data: string) => void;
  env?: Record<string, string | undefined>;
}

function base64Length(text: string): number {
  return Buffer.from(text, "utf8").toString("base64").length;
}

/** Head-truncates `text` so its base64 encoding fits within the cap. */
function truncateToCap(text: string): { text: string; truncated: boolean } {
  if (base64Length(text) <= OSC52_CAP_BASE64_BYTES) {
    return { text, truncated: false };
  }
  // Binary-search the largest prefix (in UTF-16 code units) whose base64
  // encoding fits the cap. Good enough for the ceiling this guards.
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (base64Length(text.slice(0, mid)) <= OSC52_CAP_BASE64_BYTES) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }
  return { text: text.slice(0, lo), truncated: true };
}

function oscSequence(text: string): string {
  const base64 = Buffer.from(text, "utf8").toString("base64");
  return `\x1b]52;c;${base64}\x07`;
}

/** Wraps an OSC sequence for tmux passthrough: doubles the inner ESC and
 * frames it as a tmux DCS passthrough sequence, per tmux's `allow-passthrough`. */
function wrapForTmux(seq: string): string {
  return `\x1bPtmux;${seq.replace(/\x1b/g, "\x1b\x1b")}\x1b\\`;
}

/** PowerShell 5.1 loading WinForms cold is slow; this only guards a hang. */
const POWERSHELL_TIMEOUT_MS = 10_000;

// powershell.exe (5.1) ships with every supported Windows and runs STA by
// default, which Clipboard.GetImage() requires; pwsh is the fallback for the
// rare box where the built-in one has been removed.
const WINDOWS_SHELLS = ["powershell.exe", "pwsh.exe"];

/**
 * PowerShell that saves the clipboard image to `destPath`, exiting non-zero
 * when the clipboard holds no image. It writes a file rather than stdout
 * because PowerShell re-encodes stdout and corrupts binary on the way out.
 */
export function buildClipboardImageScript(destPath: string): string {
  // Single-quoted PowerShell strings are literal; a quote inside the path
  // (C:\Users\O'Brien\AppData\...) is escaped by doubling it.
  const quoted = `'${destPath.replace(/'/g, "''")}'`;
  return [
    "$ErrorActionPreference = 'Stop'",
    "Add-Type -AssemblyName System.Windows.Forms, System.Drawing",
    "$img = [System.Windows.Forms.Clipboard]::GetImage()",
    "if ($null -eq $img) { exit 1 }",
    `$img.Save(${quoted}, [System.Drawing.Imaging.ImageFormat]::Png)`,
  ].join("\n");
}

/**
 * -EncodedCommand takes base64 of UTF-16LE. Going through it means neither
 * Node's Windows argument quoting nor PowerShell's own parser ever sees the
 * script's quotes, brackets or newlines.
 */
export function encodePowerShellCommand(script: string): string {
  return Buffer.from(script, "utf16le").toString("base64");
}

/**
 * Windows exposes no `wl-paste` equivalent — the clipboard is reachable only
 * through the Win32 API, and PowerShell is the one interpreter always there.
 */
async function readImageOnWindows(): Promise<Buffer | null> {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const { readFile, rm } = await import("node:fs/promises");
  const os = await import("node:os");
  const path = await import("node:path");

  const execFileAsync = promisify(execFile);
  const dest = path.join(
    os.tmpdir(),
    `freecode-clipboard-${process.pid}-${Date.now()}.png`,
  );
  const args = [
    "-NoProfile",
    "-NonInteractive",
    "-STA",
    "-EncodedCommand",
    encodePowerShellCommand(buildClipboardImageScript(dest)),
  ];

  try {
    for (const shell of WINDOWS_SHELLS) {
      try {
        await execFileAsync(shell, args, {
          windowsHide: true,
          timeout: POWERSHELL_TIMEOUT_MS,
        });
        return await readFile(dest);
      } catch {
        // Shell not installed, or nothing on the clipboard — try the next.
        continue;
      }
    }
    return null;
  } finally {
    await rm(dest, { force: true }).catch(() => {});
  }
}

async function readImageWithClipboardTool(): Promise<Buffer | null> {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");

  const execFileAsync = promisify(execFile);

  // wl-paste first: Wayland is the common case on modern Linux, and on a
  // Wayland session xclip may exist but return nothing.
  const tools = [
    ["wl-paste", "-t", "image/png"],
    ["xclip", "-selection", "clipboard", "-t", "image/png", "-o"],
    ["pngpaste", "-"], // macOS
  ];

  for (const [cmd, ...args] of tools) {
    try {
      // `encoding: "buffer"` is load-bearing: the default utf8 decode
      // mangles every non-UTF-8 byte into U+FFFD, so a PNG comes back
      // corrupt and larger than it went in. maxBuffer must also be raised —
      // the 1MB default rejects most screenshots before the size check
      // below ever runs.
      const { stdout } = await execFileAsync(cmd, args, {
        encoding: "buffer",
        maxBuffer: MAX_CLIPBOARD_IMAGE_SIZE + 1024,
      });
      const buf = Buffer.from(stdout);
      if (buf.length > 0) return buf;
    } catch {
      // Tool not installed, no image on the clipboard, or output over
      // maxBuffer — try the next one.
      continue;
    }
  }
  return null;
}

/**
 * Reads an image from the system clipboard (if available).
 * Returns undefined if no image is in the clipboard or if reading fails.
 */
export async function readImageFromClipboard(): Promise<
  { data: string; mediaType: string } | undefined
> {
  try {
    const imageBuffer =
      process.platform === "win32"
        ? await readImageOnWindows()
        : await readImageWithClipboardTool();

    if (!imageBuffer || imageBuffer.length === 0) {
      return undefined;
    }

    if (imageBuffer.length > MAX_CLIPBOARD_IMAGE_SIZE) {
      return undefined;
    }

    const mediaType = detectImageMediaType(imageBuffer);
    if (!mediaType) return undefined;

    return {
      data: imageBuffer.toString("base64"),
      mediaType,
    };
  } catch {
    // No image in clipboard or tool not available
    return undefined;
  }
}

/**
 * Why a paste came up empty. The install hint is wrong on Windows, where the
 * clipboard is read through PowerShell and there is nothing to install.
 */
export function noClipboardImageMessage(
  platform: NodeJS.Platform = process.platform,
): string {
  return platform === "win32"
    ? "No image on the clipboard."
    : "No image on the clipboard. (Needs `wl-paste`, `xclip`, or `pngpaste` installed.)";
}

/**
 * Identifies an image by magic bytes. Returns undefined for anything that
 * isn't a format the vision APIs accept, so non-image clipboard contents
 * never get sent up as a bogus image/png.
 */
export function detectImageMediaType(buf: Buffer): string | undefined {
  if (buf.length >= 8 && buf.subarray(0, 8).equals(PNG_MAGIC)) {
    return "image/png";
  }
  if (
    buf.length >= 3 &&
    buf[0] === 0xff &&
    buf[1] === 0xd8 &&
    buf[2] === 0xff
  ) {
    return "image/jpeg";
  }
  if (
    buf.length >= 6 &&
    buf
      .subarray(0, 6)
      .toString("ascii")
      .match(/^GIF8[79]a$/)
  ) {
    return "image/gif";
  }
  // WebP is a RIFF container: "RIFF" <4-byte size> "WEBP". Checking only
  // "RIFF" would also match WAV and AVI.
  if (
    buf.length >= 12 &&
    buf.subarray(0, 4).toString("ascii") === "RIFF" &&
    buf.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "image/webp";
  }
  return undefined;
}

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export function copyToClipboard(
  text: string,
  opts: CopyOptions = {},
): CopyResult {
  const write = opts.write ?? ((data: string) => process.stdout.write(data));
  const env = opts.env ?? process.env;

  const { text: capped, truncated } = truncateToCap(text);
  const seq = oscSequence(capped);
  const sequence = env.TMUX ? wrapForTmux(seq) : seq;
  write(sequence);

  return { copied: capped, truncated };
}
