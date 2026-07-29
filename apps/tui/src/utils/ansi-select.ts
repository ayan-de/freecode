import stringWidth from "string-width";
import stripAnsi from "strip-ansi";

const REVERSE_ON = "\x1b[7m";
const REVERSE_OFF = "\x1b[27m";

// Matches a single SGR/CSI escape sequence so we can walk `ansiLine`
// character-by-character while skipping escape bytes when counting columns.
const ANSI_SEQUENCE_RE = /^(?:\x1b\[[0-9;]*[a-zA-Z])/;

export function displayWidth(text: string): number {
  return stringWidth(text);
}

export function plainText(ansiLine: string): string {
  return stripAnsi(ansiLine);
}

/**
 * Wraps the display-column range [startCol, endCol) of an ANSI-styled line
 * in reverse video, without disturbing any existing escape sequences.
 * Walks the raw string, tracking visible display-column position; escape
 * sequences pass through untouched and don't advance the column counter.
 */
export function highlightRange(
  ansiLine: string,
  startCol: number,
  endCol: number,
): string {
  const width = displayWidth(ansiLine);
  const start = Math.max(0, Math.min(startCol, width));
  const end = Math.max(start, Math.min(endCol, width));
  if (start === end) return ansiLine;

  let out = "";
  let col = 0;
  let i = 0;
  let reverseOpen = false;

  while (i < ansiLine.length) {
    const rest = ansiLine.slice(i);
    const escMatch = ANSI_SEQUENCE_RE.exec(rest);
    if (escMatch) {
      out += escMatch[0];
      i += escMatch[0].length;
      continue;
    }

    if (col === start && !reverseOpen) {
      out += REVERSE_ON;
      reverseOpen = true;
    }
    if (col === end && reverseOpen) {
      out += REVERSE_OFF;
      reverseOpen = false;
    }

    const ch = [...rest][0]; // grapheme-safe single unit for width purposes
    out += ch;
    col += displayWidth(ch);
    i += ch.length;
  }

  if (reverseOpen) out += REVERSE_OFF;
  return out;
}
