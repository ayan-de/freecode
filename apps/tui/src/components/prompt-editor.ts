import { Editor, getKeybindings, matchesKey, type TUI } from "@earendil-works/pi-tui";
import type { EditorTheme } from "@earendil-works/pi-tui";
import chalk from "chalk";

/** Image data from clipboard */
export interface PendingImage {
  data: string;
  mediaType: string;
}

/**
 * Format the prompt-history index for the bottom-border indicator.
 * 1-based from the most recent entry, so `[3/12]` is the 3rd-most-recent of
 * 12. Returns null when not browsing (`historyIndex === -1`) or when the
 * ring is empty.
 *
 * Pure helper — extracted from `PromptEditor` so it can be unit-tested
 * without standing up a pi-tui `TUI` + `Terminal`.
 */
export function formatHistoryIndicator(
  historyIndex: number,
  total: number,
): string | null {
  if (historyIndex < 0 || total === 0) return null;
  return `[${historyIndex + 1}/${total}]`;
}

/**
 * Build a bottom-border strip with the history indicator spliced just after
 * the leading dashes. Re-emits the entire line through `borderColor` so the
 * ANSI seams stay consistent (mixing colored and uncolored runs would leak
 * the color's reset code into the middle).
 */
export function buildHistoryBorder(
  indicator: string,
  width: number,
  borderColor: (s: string) => string,
  sideDashes = 2,
): string {
  const text = ` ${indicator} `;
  const textVisible = text.length;
  const dashCount = Math.max(0, width - textVisible);
  const leftCount = Math.min(sideDashes, dashCount);
  const rightCount = Math.max(0, dashCount - leftCount);
  return borderColor("─".repeat(leftCount) + text + "─".repeat(rightCount));
}

/**
 * Inline placeholder for a pasted image, in Claude Code's `[Image #N]` shape.
 * The token is ordinary editor text, so it word-wraps, moves, and deletes like
 * anything the user typed — the yellow chip styling and whole-token backspace
 * are layered on top by this class, the way pi-tui layers them onto its own
 * `[paste #N]` markers.
 */
const IMAGE_TOKEN = /\[Image #(\d+)\]/g;

/** Same token, anchored to the end of a string (for the char before the cursor). */
const IMAGE_TOKEN_AT_END = /\[Image #\d+\]$/;

/** CSI colour codes and pi-tui's zero-width APC cursor marker. */
const ANSI_SEQUENCE = /\x1b(?:\[[0-9;?]*[a-zA-Z]|[_\]][^\x07]*\x07)/g;

/** Remove `[Image #N]` placeholders — the model gets the bytes, not the label. */
export function stripImageTokens(text: string): string {
  return text.replace(IMAGE_TOKEN, "");
}

/**
 * Highlight @mentions in the editor content with yellow color.
 * Matches @word patterns (alphanumeric + underscore + dash + slash + dot)
 */
function highlightMentions(text: string): string {
  // Match @ followed by word characters, path separators, dots, etc.
  // This captures: @filename, @path/to/file, @file.ts, etc.
  return text.replace(/(@[^\s]+)/g, (match) => chalk.yellow(match));
}

/** Split a rendered line into alternating escape-sequence and plain-text runs. */
function splitAnsi(line: string): Array<{ ansi: boolean; text: string }> {
  const parts: Array<{ ansi: boolean; text: string }> = [];
  let last = 0;
  for (const m of line.matchAll(ANSI_SEQUENCE)) {
    if (m.index > last) parts.push({ ansi: false, text: line.slice(last, m.index) });
    parts.push({ ansi: true, text: m[0] });
    last = m.index + m[0].length;
  }
  if (last < line.length) parts.push({ ansi: false, text: line.slice(last) });
  return parts;
}

/**
 * Paint `[Image #N]` tokens as a yellow chip on an already-rendered line.
 *
 * The line may already carry escape codes — mention highlighting, and pi-tui's
 * fake cursor (`\x1b[7m<grapheme>\x1b[0m`) which can land *inside* a token and
 * split it. So tokens are located in the escape-stripped text and the chip is
 * applied per plain-text run, leaving every existing sequence untouched. The
 * run under the cursor is skipped so the cursor stays visible on top of a chip.
 *
 * Only escape codes are added, never characters, so the editor's column math
 * and line padding are unaffected.
 */
function styleImageTokens(line: string): string {
  const parts = splitAnsi(line);
  const plain = parts.filter((p) => !p.ansi).map((p) => p.text).join("");
  if (!plain.includes("[Image #")) return line;

  // Mark the plain-text columns covered by a token.
  const inToken = new Uint8Array(plain.length);
  for (const m of plain.matchAll(IMAGE_TOKEN)) {
    inToken.fill(1, m.index, m.index + m[0].length);
  }

  let out = "";
  let col = 0;
  let underCursor = false;
  for (const part of parts) {
    if (part.ansi) {
      out += part.text;
      if (part.text === "\x1b[7m") underCursor = true;
      else if (part.text === "\x1b[0m") underCursor = false;
      continue;
    }
    // Emit maximal runs that are uniformly inside or outside a token.
    let i = 0;
    while (i < part.text.length) {
      const inside = inToken[col + i];
      let j = i + 1;
      while (j < part.text.length && inToken[col + j] === inside) j++;
      const run = part.text.slice(i, j);
      out += inside && !underCursor ? chalk.black.bgYellow(run) : run;
      i = j;
    }
    col += part.text.length;
  }
  return out;
}

/**
 * PromptEditor — pi-tui Editor with a `❯` prompt prefix on the input line,
 * like Claude Code. Highlights @filename mentions in yellow.
 *
 * Pasted images are inserted inline as `[Image #N]` tokens at the cursor, so
 * they sit between the words the user typed and can be repositioned or removed
 * by editing. One backspace deletes a whole chip.
 *
 * Padding reserves two columns on every content line; the prefix is painted
 * into the reserved space of the first line, so cursor column math and line
 * widths are unchanged. The prefix uses the editor's border color, so it
 * follows the agent-mode color automatically.
 */
export class PromptEditor extends Editor {
  /** Image ID → bytes. Entries are dropped when their token leaves the text. */
  private images = new Map<number, PendingImage>();
  /** Next 1-based token ID; reset per submitted prompt, like pi's paste IDs. */
  private nextImageId = 1;

  constructor(tui: TUI, theme: EditorTheme) {
    super(tui, theme, { paddingX: 2 });
  }

  /** Insert an image at the cursor as a `[Image #N]` chip. Returns its ID. */
  insertImageAtCursor(image: PendingImage): number {
    const id = this.nextImageId++;
    this.images.set(id, image);
    this.insertTextAtCursor(`[Image #${id}]`);
    return id;
  }

  /** True if these exact bytes are still attached — used to reject a re-paste. */
  hasImage(data: string): boolean {
    return this.resolve(this.getText()).some((img) => img.data === data);
  }

  /**
   * Images referenced by the submitted text, in the order they appear, and
   * reset for the next prompt. Call this from `onSubmit`: pi-tui clears the
   * editor *before* firing the callback, so the tokens only exist in `text`
   * by then. Chips the user deleted are simply absent and never uploaded.
   */
  takeImagesFor(text: string): PendingImage[] {
    const images = this.resolve(text);
    this.images.clear();
    this.nextImageId = 1;
    return images;
  }

  /**
   * Look up the images `text` refers to, dropping any whose token is gone so a
   * deleted chip stops costing an upload.
   */
  private resolve(text: string): PendingImage[] {
    const seen = new Set<number>();
    const found: PendingImage[] = [];
    for (const m of text.matchAll(IMAGE_TOKEN)) {
      const id = Number.parseInt(m[1] ?? "", 10);
      if (seen.has(id)) continue;
      seen.add(id);
      const image = this.images.get(id);
      if (image) found.push(image);
    }
    for (const id of this.images.keys()) {
      if (!seen.has(id)) this.images.delete(id);
    }
    return found;
  }

  /**
   * Make backspace delete a whole chip. A `[Image #1]` token is ten characters
   * the user never typed individually, so erasing it one at a time (and briefly
   * leaving `[Image #` on screen) is not what backspace means here. The delete
   * is replayed through the base editor so cursor, wrapping, and undo stay in
   * its hands.
   */
  handleInput(data: string): void {
    if (this.isBackspace(data)) {
      const token = this.tokenBeforeCursor();
      if (token) {
        for (let i = 0; i < token.length; i++) super.handleInput(data);
        return;
      }
    }
    super.handleInput(data);
  }

  private isBackspace(data: string): boolean {
    return (
      getKeybindings().matches(data, "tui.editor.deleteCharBackward") ||
      matchesKey(data, "shift+backspace")
    );
  }

  /** The `[Image #N]` token ending exactly at the cursor, if any. */
  private tokenBeforeCursor(): string | null {
    const { line, col } = this.getCursor();
    const text = this.getLines()[line] ?? "";
    return IMAGE_TOKEN_AT_END.exec(text.slice(0, col))?.[0] ?? null;
  }

  render(width: number): string[] {
    const editorLines = super.render(width);

    // Content lines carry the two-column padding; borders and scroll
    // indicators don't. Mentions are highlighted first so the chip pass sees
    // their escape codes as sequences rather than swallowing them.
    for (let i = 1; i < editorLines.length; i++) {
      const line = editorLines[i] ?? "";
      if (!line.startsWith("  ")) continue;
      editorLines[i] = styleImageTokens(highlightMentions(line));
    }

    // lines[0] is the top border; the first content line follows it.
    if (editorLines.length > 1 && (editorLines[1] ?? "").startsWith("  ")) {
      editorLines[1] = this.borderColor("❯") + (editorLines[1] ?? "").slice(1);
    }

    // While paging through history with up/down, stamp `[N/total]` onto the
    // bottom border so the user knows how far they've gone. pi-tui keeps
    // historyIndex private, so reach for the runtime field TypeScript hides.
    // We rebuild the border from scratch (rather than editing the existing
    // colored line in place) to keep ANSI consistent at the seams.
    const lastIdx = editorLines.length - 1;
    const indicator = this.historyIndicator();
    if (indicator !== null && lastIdx >= 0) {
      editorLines[lastIdx] = buildHistoryBorder(indicator, width, this.borderColor);
    }
    return editorLines;
  }

  /**
   * `[N/total]` for the current up/down position, or null when not browsing
   * history (historyIndex === -1) or when the ring is empty.
   */
  private historyIndicator(): string | null {
    const base = this as unknown as {
      historyIndex?: number;
      history?: string[];
    };
    const idx = base.historyIndex ?? -1;
    const total = base.history?.length ?? 0;
    return formatHistoryIndicator(idx, total);
  }
}
