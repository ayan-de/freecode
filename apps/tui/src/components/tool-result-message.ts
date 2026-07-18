import { Component, Text, Box, truncateToWidth } from "@earendil-works/pi-tui";
import chalk from "chalk";
import { renderDiff, looksLikeDiff } from "./diff-view.js";

export interface ToolResultMessageOptions {
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
  result?: string;
  success: boolean;
  duration_ms?: number;
}

// Color mapping for different tools
const TOOL_COLORS: Record<string, (text: string) => string> = {
  Read: (t) => chalk.blue(t),
  Write: (t) => chalk.green(t),
  Edit: (t) => chalk.yellow(t),
  Bash: (t) => chalk.red(t),
  Glob: (t) => chalk.cyan(t),
  Grep: (t) => chalk.magenta(t),
  Skill: (t) => chalk.white(t),
  Agent: (t) => chalk.white(t),
};

export class ToolResultMessage implements Component {
  /** Max result lines shown before collapsing to a "… +N lines" tail. */
  private static readonly MAX_PREVIEW_LINES = 5;
  /** Diffs get a larger budget since they are the message's main content. */
  private static readonly MAX_DIFF_LINES = 30;

  private toolCallId: string;
  private toolName: string;
  private args: Record<string, unknown>;
  private result?: string;
  private success: boolean;
  private duration_ms?: number;

  constructor(options: ToolResultMessageOptions) {
    this.toolCallId = options.toolCallId;
    this.toolName = options.toolName;
    this.args = options.args;
    this.result = options.result;
    this.success = options.success;
    this.duration_ms = options.duration_ms;
  }

  invalidate(): void {
    // Nothing to clean up
  }

  render(width: number): string[] {
    const colorFn = TOOL_COLORS[this.toolName] || ((t: string) => t);
    const statusIcon = this.success ? chalk.green("✓") : chalk.red("✗");
    const argsStr = this.formatArgs();
    const duration = this.duration_ms ? `(${this.duration_ms}ms)` : "";

    const lines: string[] = [];
    lines.push(""); // Empty line above

    // Header line: [✓/✗] ToolName (args) (duration) - truncated to safe width
    const safeWidth = Math.max(20, width - 1);
    let header = `${chalk.dim("[")}${statusIcon}${chalk.dim("]")} ${colorFn(this.toolName)} ${chalk.dim("(")}${argsStr}${chalk.dim(")")} ${chalk.dim(duration)}`;
    header = truncateToWidth(header, safeWidth);
    lines.push(header);

    // Result with tree view character - account for prefix.
    // The result may span many lines; render() must return one terminal row
    // per array element, so split and show a collapsed preview (pi-style).
    const resultWidth = safeWidth - 3; // 3 for " ⎿ "
    // The stream delivers a tool's result as JSON ({ title, output, metadata })
    // for object-returning tools; unwrap to the human-facing `output` so we
    // render the diff/text instead of a raw JSON blob.
    const displayResult = this.unwrapOutput(this.result);
    if (displayResult && looksLikeDiff(displayResult)) {
      // Edit/Write emit a line-numbered diff; colorize it and allow a larger
      // budget than plain output since the diff is the point of the message.
      const colored = renderDiff(displayResult.replace(/\r/g, ""), resultWidth);
      const preview = colored.slice(0, ToolResultMessage.MAX_DIFF_LINES);
      preview.forEach((raw, i) => {
        const prefix = i === 0 ? chalk.dim("⎿") : " ";
        lines.push(`${prefix} ${raw}`);
      });
      const hidden = colored.length - preview.length;
      if (hidden > 0) {
        lines.push(
          `  ${chalk.dim(`… +${hidden} line${hidden === 1 ? "" : "s"}`)}`,
        );
      }
    } else if (displayResult) {
      const resultLines = displayResult.replace(/\r/g, "").split("\n");
      const preview = resultLines.slice(0, ToolResultMessage.MAX_PREVIEW_LINES);
      preview.forEach((raw, i) => {
        const prefix = i === 0 ? chalk.dim("⎿") : " ";
        lines.push(`${prefix} ${chalk.dim(truncateToWidth(raw, resultWidth))}`);
      });
      const hidden = resultLines.length - preview.length;
      if (hidden > 0) {
        lines.push(
          `  ${chalk.dim(`… +${hidden} line${hidden === 1 ? "" : "s"}`)}`,
        );
      }
    } else if (this.success) {
      lines.push(`${chalk.dim("⎿")} ${chalk.dim("(no output)")}`);
    }

    lines.push(""); // Empty line below
    return lines;
  }

  // Object-returning tools arrive as JSON like { title, output, metadata }.
  // Extract the `output` string for display; pass plain strings through as-is.
  private unwrapOutput(result?: string): string | undefined {
    if (!result) return result;
    const trimmed = result.trimStart();
    if (!trimmed.startsWith("{")) return result;
    try {
      const parsed = JSON.parse(result) as { output?: unknown };
      if (parsed && typeof parsed.output === "string") return parsed.output;
    } catch {
      // Not JSON — fall through to the raw string.
    }
    return result;
  }

  private formatArgs(): string {
    const entries = Object.entries(this.args);
    if (entries.length === 0) return "";

    const truncate = (s: string, max = 40) =>
      s.length > max ? s.slice(0, max) + "..." : s;

    let result = entries
      .map(([k, v]) => {
        // String args (e.g. edit's old_string) may contain newlines — flatten
        // so the header stays a single terminal row.
        const vStr = (typeof v === "string" ? v : JSON.stringify(v)).replace(
          /\s*\n\s*/g,
          " ",
        );
        return `${k}: ${chalk.green(truncate(vStr))}`;
      })
      .join(", ");

    // If result exceeds 100 chars, truncate the whole thing
    if (result.length > 100) {
      result = result.slice(0, 100) + "...";
    }
    return result;
  }

  private truncateResult(result: string, maxLen: number): string {
    if (result.length <= maxLen) return result;
    return result.slice(0, maxLen) + "...";
  }
}
