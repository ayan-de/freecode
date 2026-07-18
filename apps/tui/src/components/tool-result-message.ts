import { Component, Text, Box, truncateToWidth } from "@earendil-works/pi-tui";
import chalk from "chalk";
import { renderDiff, looksLikeDiff, getDiffStats } from "./diff-view.js";

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
    const statusIcon = this.success ? chalk.green("●") : chalk.red("✖");
    const argsStr = this.formatArgs();
    const duration = this.duration_ms ? `(${this.duration_ms}ms)` : "";

    const lines: string[] = [];
    lines.push(""); // Empty line above

    const safeWidth = Math.max(20, width - 1);
    
    let headerAction = this.toolName;
    let headerTarget = `(${argsStr})`;
    
    // Custom formatting for common tools like Claude Code
    const isFileUpdate = ["Write", "Edit", "replace_file_content", "multi_replace_file_content"].includes(this.toolName);
    const isFileRead = ["Read", "view_file"].includes(this.toolName);
    const isRun = ["Bash", "run_command"].includes(this.toolName);

    if ((isFileUpdate || isFileRead) && this.args) {
      const fileArg = (this.args.TargetFile || this.args.file_path || this.args.file || this.args.AbsolutePath) as string;
      if (fileArg) {
        headerAction = isFileUpdate ? "Update" : "Read";
        const cwd = process.cwd();
        const displayFile = fileArg.startsWith(cwd) ? fileArg.slice(cwd.length + 1) : fileArg;
        headerTarget = `(${displayFile})`;
      }
    } else if (isRun && this.args) {
      const cmdArg = (this.args.CommandLine || this.args.command || "") as string;
      if (cmdArg) {
        headerAction = "Run";
        headerTarget = `(${cmdArg})`;
      }
    }

    let header = `${statusIcon} ${chalk.bold(colorFn(headerAction))}${chalk.dim(headerTarget)}`;
    if (duration) {
       header += ` ${chalk.dim(duration)}`;
    }
    
    header = truncateToWidth(header, safeWidth);
    lines.push(header);

    const resultWidth = safeWidth - 3; // 3 for "   " or "└─ "
    const displayResult = this.unwrapOutput(this.result);
    
    if (displayResult && looksLikeDiff(displayResult)) {
      const stats = getDiffStats(displayResult);
      let statText = "No changes";
      if (stats.added > 0 && stats.removed > 0) statText = `Added ${stats.added} line${stats.added === 1 ? "" : "s"}, removed ${stats.removed} line${stats.removed === 1 ? "" : "s"}`;
      else if (stats.added > 0) statText = `Added ${stats.added} line${stats.added === 1 ? "" : "s"}`;
      else if (stats.removed > 0) statText = `Removed ${stats.removed} line${stats.removed === 1 ? "" : "s"}`;

      lines.push(`${chalk.dim("└─")} ${statText}`);

      const colored = renderDiff(displayResult.replace(/\r/g, ""), resultWidth);
      const preview = colored.slice(0, ToolResultMessage.MAX_DIFF_LINES);
      preview.forEach((raw) => {
        lines.push(`   ${raw}`);
      });
      const hidden = colored.length - preview.length;
      if (hidden > 0) {
        lines.push(`   ${chalk.dim(`… +${hidden} line${hidden === 1 ? "" : "s"}`)}`);
      }
    } else if (displayResult) {
      const resultLines = displayResult.replace(/\r/g, "").split("\n");
      const preview = resultLines.slice(0, ToolResultMessage.MAX_PREVIEW_LINES);
      
      if (isRun) {
        lines.push(`${chalk.dim("└─")} Output`);
      }
      
      preview.forEach((raw, i) => {
        const prefix = (i === 0 && !isRun) ? chalk.dim("└─") : "  ";
        lines.push(` ${prefix} ${chalk.dim(truncateToWidth(raw, resultWidth))}`);
      });
      const hidden = resultLines.length - preview.length;
      if (hidden > 0) {
        lines.push(`    ${chalk.dim(`… +${hidden} line${hidden === 1 ? "" : "s"}`)}`);
      }
    } else if (this.success) {
      lines.push(` ${chalk.dim("└─")} ${chalk.dim("(no output)")}`);
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
