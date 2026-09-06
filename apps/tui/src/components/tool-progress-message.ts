import {
  Component,
  TUI,
  Text,
  Box,
  truncateToWidth,
} from "@earendil-works/pi-tui";
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
  Memory: (t) => chalk.magenta(t),
};

// One shared ticker drives every in-flight tool's spinner. Each component
// used to arm its own 250ms timer, so N parallel tools produced N redundant
// render requests per beat (pi-tui coalesces them, but each fired a full
// tree render). The spinner frame is derived from the clock at render time,
// so a single timer animates them all in step.
let activeSpinners = 0;
let spinnerTimer: ReturnType<typeof setInterval> | null = null;
let spinnerTui: TUI | null = null;

function acquireSpinner(tui: TUI): void {
  activeSpinners++;
  spinnerTui = tui;
  if (!spinnerTimer) {
    spinnerTimer = setInterval(() => spinnerTui?.requestRender(), 250);
    spinnerTimer.unref?.();
  }
}

function releaseSpinner(): void {
  if (activeSpinners > 0) activeSpinners--;
  if (activeSpinners === 0 && spinnerTimer) {
    clearInterval(spinnerTimer);
    spinnerTimer = null;
  }
}

export class ToolProgressMessage implements Component {
  private toolCallId: string;
  private toolName: string;
  private args: Record<string, unknown>;
  private outputLines: string[];
  private tui?: TUI;
  private released = false;
  /** formatArgs is pure over the immutable args — computed once. */
  private argsStr?: string;

  constructor(options: ToolProgressMessageOptions) {
    this.toolCallId = options.toolCallId;
    this.toolName = options.toolName;
    this.args = options.args;
    this.outputLines = options.outputLines;
  }

  setTui(tui: TUI): void {
    this.tui = tui;
    acquireSpinner(tui);
  }

  updateOutput(outputLines: string[]): void {
    this.outputLines = outputLines;
  }

  invalidate(): void {
    // Called when the tool completes and the row is removed; the shared
    // ticker refcount must drop exactly once per component.
    if (this.tui && !this.released) {
      this.released = true;
      releaseSpinner();
    }
  }

  render(width: number): string[] {
    // Core emits lowercase tool ids ("read", "bash") while the map keys are
    // capitalized — same three-way fallback as ToolResultMessage, without
    // which no progress row ever got its color.
    const colorFn =
      TOOL_COLORS[this.toolName] ||
      TOOL_COLORS[
        this.toolName.charAt(0).toUpperCase() +
          this.toolName.slice(1).toLowerCase()
      ] ||
      ((t: string) => t);
    const spinner = ["⠋", "⠙", "⠹", "⠸"][Math.floor(Date.now() / 250) % 4];
    const argsStr = (this.argsStr ??= this.formatArgs());

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
      lines.push(
        `${chalk.dim("│")} ${chalk.dim(truncateToWidth(outputLine, outputWidth))}`,
      );
    }

    lines.push(""); // Empty line below
    return lines;
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
}
