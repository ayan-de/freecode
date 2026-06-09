import { Component, TUI, Text, Box, truncateToWidth } from "@earendil-works/pi-tui";
import chalk from "chalk";

export interface ToolProgressMessageOptions {
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
  outputLines: string[];
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

export class ToolProgressMessage implements Component {
  private toolCallId: string;
  private toolName: string;
  private args: Record<string, unknown>;
  private outputLines: string[];
  private tui?: TUI;
  private animationFrame = 0;
  private intervalId?: ReturnType<typeof setInterval>;

  constructor(options: ToolProgressMessageOptions) {
    this.toolCallId = options.toolCallId;
    this.toolName = options.toolName;
    this.args = options.args;
    this.outputLines = options.outputLines;
  }

  setTui(tui: TUI): void {
    this.tui = tui;
    // Start animation
    this.intervalId = setInterval(() => {
      this.animationFrame = (this.animationFrame + 1) % 4;
      this.tui?.requestRender();
    }, 250);
  }

  updateOutput(outputLines: string[]): void {
    this.outputLines = outputLines;
  }

  invalidate(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = undefined;
    }
  }

  render(width: number): string[] {
    const colorFn = TOOL_COLORS[this.toolName] || ((t: string) => t);
    const spinner = ["⠋", "⠙", "⠹", "⠸"][this.animationFrame];
    const argsStr = this.formatArgs();

    const lines: string[] = [];
    lines.push(""); // Empty line above

    // Header line: [spinner] ToolName (args)
    const headerWidth = Math.max(20, width - 3);
    let header = `${chalk.dim("[")}${chalk.yellow(spinner)}${chalk.dim("]")} ${colorFn(this.toolName)} ${chalk.dim("(")}${argsStr}${chalk.dim(")")}`;
    header = truncateToWidth(header, headerWidth);
    lines.push(header);

    // Output lines with tree view - account for prefix (3 chars: "│  ")
    const outputWidth = Math.max(20, width - 4);
    for (const outputLine of this.outputLines.slice(-5)) {
      lines.push(`${chalk.dim("│")} ${chalk.dim(truncateToWidth(outputLine, outputWidth))}`);
    }

    lines.push(""); // Empty line below
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
}
