/** Historical safe ceiling for OSC 52 payloads across common terminals. */
export const OSC52_CAP_BASE64_BYTES = 100 * 1024;

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

export function copyToClipboard(text: string, opts: CopyOptions = {}): CopyResult {
  const write = opts.write ?? ((data: string) => process.stdout.write(data));
  const env = opts.env ?? process.env;

  const { text: capped, truncated } = truncateToCap(text);
  const seq = oscSequence(capped);
  const sequence = env.TMUX ? wrapForTmux(seq) : seq;
  write(sequence);

  return { copied: capped, truncated };
}
