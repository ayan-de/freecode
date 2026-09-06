import { truncateToWidth, type Component } from "@earendil-works/pi-tui";
import chalk from "chalk";
import { logoLines } from "../assets/logo.js";
import { getDisplayDirectory, getVersion } from "../utils/display.js";

// Two-tone yellow to match the existing info-box logo treatment.
const coloredLogoLines = logoLines.map((line) => {
  const mid = Math.floor(line.length / 2);
  return chalk.yellowBright(line.slice(0, mid)) + chalk.yellow(line.slice(mid));
});

const LOGO_WIDTH = 34;

/** "-1" sentinel from the index.ts cache means "not loaded yet". */
const PENDING = "…";

/**
 * Pinned top-of-TUI logo header. Renders the FreeCode logo (centered, two-tone
 * yellow) with the `>_ FreeCode (vX.Y.Z)` subtitle, a compact stats line
 * (tools + MCP counts) and a directory line — all centered and in yellow.
 *
 * Tool/MCP counts come from accessor functions so the parent can cache them
 * once at startup and the header stays synchronous.
 */
export class LogoHeader implements Component {
  /**
   * Rendered every frame as the message list's first entry (even in follow
   * mode, where the window slice usually discards it), so the lines are
   * cached on everything they actually depend on: width and the two counts
   * (version and cwd are fixed for the process).
   */
  private cache?: { width: number; tools: number; mcp: number; lines: string[] };

  constructor(
    private getToolCount: () => number,
    private getMcpCount: () => number,
  ) {}

  invalidate(): void {
    this.cache = undefined;
  }

  /**
   * Center a styled fragment by padding with spaces. `visiblePlainLen` is the
   * width of the *plain* (ANSI-stripped) text — needed because chalk adds
   * escape codes that mis-align a naive `.length` measurement.
   */
  private centerLine(width: number, visiblePlainLen: number, styled: string): string {
    const padLeft = Math.max(0, Math.floor((width - visiblePlainLen) / 2));
    const padRight = Math.max(0, width - visiblePlainLen - padLeft);
    return " ".repeat(padLeft) + styled + " ".repeat(padRight);
  }

  private formatCount(n: number): string {
    return n < 0 ? PENDING : String(n);
  }

  render(width: number): string[] {
    if (width < LOGO_WIDTH) {
      // Logo is 34 chars wide; skip the overlay rather than truncating it.
      return [];
    }

    const toolCount = this.getToolCount();
    const mcpCount = this.getMcpCount();
    if (
      this.cache &&
      this.cache.width === width &&
      this.cache.tools === toolCount &&
      this.cache.mcp === mcpCount
    ) {
      return this.cache.lines;
    }

    const padLeft = Math.max(0, Math.floor((width - LOGO_WIDTH) / 2));
    const padRight = Math.max(0, width - LOGO_WIDTH - padLeft);
    const indent = " ".repeat(padLeft);
    const rightPad = " ".repeat(padRight);

    // Subtitle: `>_ FreeCode (vX.Y.Z)` — plain + styled built separately so the
    // centered pad math matches the visible width.
    const version = getVersion();
    const subtitlePlain = `>_ FreeCode (v${version})`;
    const subtitleStyled =
      `>_ ${chalk.bold.yellowBright("FreeCode")} ` +
      chalk.dim(`(v${version})`);
    const subtitleLine = this.centerLine(width, subtitlePlain.length, subtitleStyled);

    // Stats: `Tools: N    MCP: M` — dimmed labels, plain values.
    const toolsPlain = this.formatCount(this.getToolCount());
    const mcpPlain = this.formatCount(this.getMcpCount());
    const statsPlain = `Tools: ${toolsPlain}    MCP: ${mcpPlain}`;
    const statsStyled =
      chalk.dim("Tools:") +
      ` ${toolsPlain}` +
      " ".repeat(4) +
      chalk.dim("MCP:") +
      ` ${mcpPlain}`;
    const statsLine = this.centerLine(width, statsPlain.length, statsStyled);

    // Directory: `Directory: <cwd>` — dimmed label, plain path.
    const cwd = getDisplayDirectory();
    const dirPlain = `Directory: ${cwd}`;
    const dirStyled = chalk.dim("Directory:") + ` ${cwd}`;
    const dirLine = this.centerLine(width, dirPlain.length, dirStyled);

    const lines = [
      `${indent}${coloredLogoLines[0]}${rightPad}`,
      `${indent}${coloredLogoLines[1]}${rightPad}`,
      `${indent}${coloredLogoLines[2]}${rightPad}`,
      subtitleLine,
      statsLine,
      dirLine,
    ].map((line) => truncateToWidth(line, width));
    this.cache = { width, tools: toolCount, mcp: mcpCount, lines };
    return lines;
  }
}
