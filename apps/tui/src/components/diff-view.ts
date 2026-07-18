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

/**
 * Colorize a core-generated diff string into terminal rows.
 * Context lines are dim, removals red, additions green. Each row is truncated
 * to `width`. The frontend only paints colors — core owns the diff computation.
 */
export function renderDiff(diffText: string, width: number): string[] {
  return diffText.split("\n").map((line) => {
    const m = line.match(DIFF_LINE);
    const row = truncateToWidth(line, width);
    if (!m) return chalk.dim(row);
    switch (m[1]) {
      case "+":
        return chalk.green(row);
      case "-":
        return chalk.red(row);
      default:
        return chalk.dim(row);
    }
  });
}
