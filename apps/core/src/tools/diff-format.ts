// =============================================================================
// Diff formatting — turn old/new file content into a compact, line-numbered
// display diff. Colorization happens in the frontend (thin-client): this only
// emits plain text where each line is prefixed with "+"/"-"/" " + line number.
// Adapted from pi's generateDiffString.
// =============================================================================

import { diffLines } from "diff";

/**
 * Build a display-oriented diff string with line numbers and collapsed context.
 * Each output line looks like:
 *   "+  12 added content"
 *   "-  12 removed content"
 *   "   12 unchanged context"
 * Runs of unchanged lines beyond `contextLines` around a change collapse to "…".
 * Returns an empty string when there is no change.
 */
export function generateDiffString(
  oldContent: string,
  newContent: string,
  contextLines = 4,
): string {
  const parts = diffLines(oldContent, newContent);

  const oldLines = oldContent.split("\n");
  const newLines = newContent.split("\n");
  const maxLineNum = Math.max(oldLines.length, newLines.length);
  const lineNumWidth = String(maxLineNum).length;

  const output: string[] = [];
  let oldLineNum = 1;
  let newLineNum = 1;
  let lastWasChange = false;

  const pad = (n: number) => String(n).padStart(lineNumWidth, " ");
  const blank = () => "".padStart(lineNumWidth, " ");

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    const raw = part.value.split("\n");
    if (raw[raw.length - 1] === "") raw.pop();

    if (part.added || part.removed) {
      for (const line of raw) {
        if (part.added) {
          output.push(`+${pad(newLineNum)} ${line}`);
          newLineNum++;
        } else {
          output.push(`-${pad(oldLineNum)} ${line}`);
          oldLineNum++;
        }
      }
      lastWasChange = true;
      continue;
    }

    // Context — only show a few lines around changes.
    const nextIsChange =
      i < parts.length - 1 && (parts[i + 1].added || parts[i + 1].removed);
    const hasLeading = lastWasChange;
    const hasTrailing = nextIsChange;

    const emitContext = (line: string) => {
      output.push(` ${pad(oldLineNum)} ${line}`);
      oldLineNum++;
      newLineNum++;
    };

    if (hasLeading && hasTrailing) {
      if (raw.length <= contextLines * 2) {
        raw.forEach(emitContext);
      } else {
        raw.slice(0, contextLines).forEach(emitContext);
        const skipped = raw.length - contextLines * 2;
        output.push(` ${blank()} …`);
        oldLineNum += skipped;
        newLineNum += skipped;
        raw.slice(raw.length - contextLines).forEach(emitContext);
      }
    } else if (hasLeading) {
      raw.slice(0, contextLines).forEach(emitContext);
      const skipped = raw.length - contextLines;
      if (skipped > 0) {
        output.push(` ${blank()} …`);
        oldLineNum += skipped;
        newLineNum += skipped;
      }
    } else if (hasTrailing) {
      const skipped = Math.max(0, raw.length - contextLines);
      if (skipped > 0) {
        output.push(` ${blank()} …`);
        oldLineNum += skipped;
        newLineNum += skipped;
      }
      raw.slice(skipped).forEach(emitContext);
    } else {
      // No adjacent change — skip entirely.
      oldLineNum += raw.length;
      newLineNum += raw.length;
    }

    lastWasChange = false;
  }

  return output.join("\n");
}
