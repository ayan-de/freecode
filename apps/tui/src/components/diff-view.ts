import chalk from "chalk";
import { truncateToWidth } from "@earendil-works/pi-tui";
import { highlight, supportsLanguage } from "cli-highlight";
import stringWidth from "string-width";
import { diffTheme } from "./code-block.js";

// Matches a line-numbered diff row produced by core's generateDiffString:
//   "+ 12 content" / "- 12 content" / "  12 content" / "     …"
const DIFF_LINE = /^([+\- ])(\s*\d*)\s(.*)$/;

export function getLanguageFromFilename(filename?: string): string | undefined {
  if (!filename) return undefined;
  const ext = filename.split('.').pop()?.toLowerCase();
  if (!ext) return undefined;
  switch (ext) {
    case 'js':
    case 'jsx':
      return 'javascript';
    case 'ts':
    case 'tsx':
      return 'typescript';
    case 'json':
      return 'json';
    case 'md':
      return 'markdown';
    case 'html':
    case 'htm':
      return 'html';
    case 'css':
      return 'css';
    case 'sh':
    case 'bash':
      return 'bash';
    case 'yml':
    case 'yaml':
      return 'yaml';
    case 'py':
      return 'python';
    case 'go':
      return 'go';
    case 'rs':
      return 'rust';
    case 'rb':
      return 'ruby';
    case 'c':
    case 'h':
    case 'cpp':
    case 'hpp':
    case 'cc':
      return 'cpp';
    case 'java':
      return 'java';
    default:
      return undefined;
  }
}

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
export function renderDiff(diffText: string, width: number, filename?: string): string[] {
  const lang = getLanguageFromFilename(filename);
  const useHighlight = lang && supportsLanguage(lang);

  return diffText.split("\n").map((line) => {
    const m = line.match(DIFF_LINE);
    if (!m) {
      const row = truncateToWidth(line, width);
      return row;
    }
    
    const indicator = m[1];
    const lineNum = m[2];
    const codeContent = m[3];

    let highlightedCode = codeContent;
    if (useHighlight && codeContent.trim().length > 0) {
      try {
        highlightedCode = highlight(codeContent, { language: lang, theme: diffTheme });
      } catch (err) {
        // Fallback to unhighlighted code
      }
    }

    const lead = `${indicator}${lineNum} `;
    let formattedLead = lead;

    switch (indicator) {
      case "+":
        formattedLead = chalk.greenBright(lead);
        break;
      case "-":
        formattedLead = chalk.redBright(lead);
        break;
      default:
        formattedLead = chalk.dim(lead);
        break;
    }

    const row = formattedLead + highlightedCode;
    const truncatedRow = truncateToWidth(row, width);

    // Compute visible length using stringWidth to pad with background color correctly
    const visibleWidth = stringWidth(truncatedRow);
    const padding = " ".repeat(Math.max(0, width - visibleWidth));
    const paddedRow = truncatedRow + padding;

    switch (indicator) {
      case "+":
        return chalk.bgHex("#143c1a")(paddedRow);
      case "-":
        return chalk.bgHex("#4d1419")(paddedRow);
      default:
        return truncatedRow;
    }
  });
}
