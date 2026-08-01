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

/**
 * Reads an image from the system clipboard (if available).
 * Returns undefined if no image is in the clipboard or if reading fails.
 */
export async function readImageFromClipboard(): Promise<
  { data: string; mediaType: string } | undefined
> {
  try {
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");

    const execFileAsync = promisify(execFile);

    let imageBuffer: Buffer | null = null;

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
        if (buf.length > 0) {
          imageBuffer = buf;
          break;
        }
      } catch {
        // Tool not installed, no image on the clipboard, or output over
        // maxBuffer — try the next one.
        continue;
      }
    }

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
