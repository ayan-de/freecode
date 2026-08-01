import { Editor, type TUI } from "@earendil-works/pi-tui";
import type { EditorTheme } from "@earendil-works/pi-tui";
import chalk from "chalk";

/** Image data from clipboard */
export interface PendingImage {
  data: string;
  mediaType: string;
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

/**
 * Render inline image tags inside the input text area
 */
function renderInlineImages(images: PendingImage[]): string[] {
  if (images.length === 0) return [];

  const tags: string[] = [];
  for (let i = 0; i < images.length; i++) {
    const image = images[i];
    // Calculate size in KB
    const sizeKb = Math.round((image.data.length * 3) / 4 / 1024);
    const sizeLabel = sizeKb >= 1024
      ? `~${(sizeKb / 1024).toFixed(1)}MB`
      : `~${sizeKb}KB`;

    tags.push(`Image#${i + 1}(${sizeLabel})`);
  }

  return [chalk.white.bgGray(` ${tags.join(" ")} `)];
}

/**
 * PromptEditor — pi-tui Editor with a `❯` prompt prefix on the input line,
 * like Claude Code. Also highlights @filename mentions in yellow.
 * Displays attached images in a yellow container above the input.
 * Padding reserves two columns on every content line; the prefix is painted
 * into the reserved space of the first line, so cursor column math and line
 * widths are unchanged. The prefix uses the editor's border color, so it
 * follows the agent-mode color automatically.
 */
export class PromptEditor extends Editor {
  private _pendingImages: PendingImage[] = [];

  constructor(tui: TUI, theme: EditorTheme) {
    super(tui, theme, { paddingX: 2 });
  }

  /** Set pending images to display in the input area */
  set pendingImages(images: PendingImage[]) {
    this._pendingImages = images;
  }

  get pendingImages(): PendingImage[] {
    return this._pendingImages;
  }

  render(width: number): string[] {
    // Render inline images at the start of the input
    const inlineImageTags = renderInlineImages(this._pendingImages);

    const editorLines = super.render(width);

    // Highlight @mentions in yellow on content lines (skip border lines)
    for (let i = 1; i < editorLines.length; i++) {
      // Only process if line starts with padding (actual content)
      if (editorLines[i].startsWith("  ")) {
        editorLines[i] = highlightMentions(editorLines[i]);
      }
    }

    // Prepend inline image tags to the first content line
    if (inlineImageTags.length > 0 && editorLines.length > 1) {
      // Find the first content line (after the border)
      const firstContentLine = editorLines[1];
      if (firstContentLine.startsWith("  ")) {
        editorLines[1] = firstContentLine + " " + inlineImageTags[0];
      }
    }

    // lines[0] is the top border; the first content line follows it.
    if (editorLines.length > 1 && editorLines[1].startsWith("  ")) {
      editorLines[1] = this.borderColor("❯") + editorLines[1].slice(1);
    }
    return editorLines;
  }
}
