import chalk from "chalk";
import { truncateToWidth } from "@earendil-works/pi-tui";

// Matches a line-numbered diff row produced by core's generateDiffString:
//   "+ 12 content" / "- 12 content" / "  12 content" / "     …"
const DIFF_LINE = /^([+\- ])(\s*\d*)\s(.*)$/;

/**
 * True when `text` looks like a core-generated line-numbered diff — i.e. it
 * contains at least one added/removed row. A diff can open with a context line,
 * so we scan rather than only inspecting the first line.
 */
export function looksLikeDiff(text: string): boolean {
  return text.split("\n").some((line) => {
    const m = line.match(DIFF_LINE);
    return m !== null && (m[1] === "+" || m[1] === "-");
  });
}

export function getDiffStats(diffText: string): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  diffText.split("\n").forEach((line) => {
    const m = line.match(DIFF_LINE);
    if (m) {
      if (m[1] === "+") added++;
      else if (m[1] === "-") removed++;
    }
  });
  return { added, removed };
}

/**
 * Colorize a core-generated diff string into terminal rows.
 * Context lines are dim, removals red background, additions green background.
 * Each row is truncated to `width`.
 */
export function renderDiff(diffText: string, width: number): string[] {
  return diffText.split("\n").map((line) => {
    const m = line.match(DIFF_LINE);
    const row = truncateToWidth(line, width);
    if (!m) return chalk.dim(row);
    
    // Pad to fill the background color across the terminal width
    const paddedRow = row.padEnd(width, " ");

    switch (m[1]) {
      case "+":
        return chalk.bgHex("#143c1a").greenBright(paddedRow);
      case "-":
        return chalk.bgHex("#4d1419").redBright(paddedRow);
      default:
        return chalk.dim(row);
    }
  });
}
