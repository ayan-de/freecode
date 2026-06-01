import { Component, Text, Box, truncateToWidth } from "@earendil-works/pi-tui";
import chalk from "chalk";

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

    // Header line: [✓/✗] ToolName (args) (duration) - truncated to width
    let header = `${chalk.dim("[")}${statusIcon}${chalk.dim("]")} ${colorFn(this.toolName)} ${chalk.dim("(")}${argsStr}${chalk.dim(")")} ${chalk.dim(duration)}`;
    header = truncateToWidth(header, width);
    lines.push(header);

    // Result with tree view character - truncated to width
    if (this.result) {
      const maxResultWidth = width > 2 ? width - 2 : width;
      const truncatedResult = truncateToWidth(this.result, maxResultWidth);
      lines.push(`${chalk.dim("⎿")} ${chalk.dim(truncatedResult)}`);
    } else if (this.success) {
      lines.push(`${chalk.dim("⎿")} ${chalk.dim("(no output)")}`);
    }

    return lines;
  }

  private formatArgs(): string {
    const entries = Object.entries(this.args);
    if (entries.length === 0) return "";

    const truncate = (s: string, max = 40) => s.length > max ? s.slice(0, max) + "..." : s;

    let result = entries
      .map(([k, v]) => {
        const vStr = typeof v === "string" ? v : JSON.stringify(v);
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
