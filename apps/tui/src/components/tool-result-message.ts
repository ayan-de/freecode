import { Component, Text, Box, truncateToWidth } from "@earendil-works/pi-tui";
import chalk from "chalk";
import { renderDiff, looksLikeDiff, getDiffStats, getLanguageFromFilename } from "./diff-view.js";
import { diffTheme } from "./code-block.js";
import { highlight, supportsLanguage } from "cli-highlight";
import { formatDuration } from "../utils/format-duration.js";

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
  Read: (t) => chalk.blueBright(t),
  Write: (t) => chalk.greenBright(t),
  Edit: (t) => chalk.yellowBright(t),
  Bash: (t) => chalk.redBright(t),
  Glob: (t) => chalk.cyanBright(t),
  Grep: (t) => chalk.magentaBright(t),
  Skill: (t) => chalk.whiteBright(t),
  Agent: (t) => chalk.whiteBright(t),
  Memory: (t) => chalk.magentaBright(t),
};

/**
 * The `:start-end` suffix on a ranged read, so a partial read is visibly
 * different from one that pulled the whole file. Empty when neither bound was
 * given — the common whole-file case stays as it was.
 */
function formatLineRange(args: Record<string, unknown> | undefined): string {
  const num = (v: unknown): number | undefined => {
    const n = typeof v === "string" ? Number(v) : v;
    return typeof n === "number" && Number.isFinite(n) ? n : undefined;
  };
  const offset = num(args?.offset);
  const limit = num(args?.limit);
  if (offset === undefined && limit === undefined) return "";

  const start = offset ?? 1;
  return limit === undefined
    ? chalk.dim(`:${start}+`)
    : chalk.dim(`:${start}-${start + limit - 1}`);
}



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
  /** Collapsed by default; a click on the header row expands the body. */
  private isCollapsed = true;
  /**
   * Whether this message has a body worth hiding. False for diffs (they are
   * the message's point and render as they always have) and for tools whose
   * output is already suppressed, so no caret ever promises content that
   * expanding would not reveal. Set during `render`.
   */
  private collapsible = false;
  /** Header row's index within the last render, for `isToggleLine`. */
  private headerLineIndex = 0;

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

  toggle(): void {
    this.isCollapsed = !this.isCollapsed;
  }

  /**
   * Only the header row toggles. Restricting it this way keeps drag-select
   * working over expanded output — a press anywhere in the body still starts a
   * selection instead of being swallowed as a collapse — and stops diff blocks,
   * which never collapse, from claiming clicks at all.
   */
  isToggleLine(localIndex: number): boolean {
    return this.collapsible && localIndex === this.headerLineIndex;
  }

  render(width: number): string[] {
    const colorFn = TOOL_COLORS[this.toolName] || TOOL_COLORS[this.toolName.toLowerCase()] || TOOL_COLORS[this.toolName.charAt(0).toUpperCase() + this.toolName.slice(1).toLowerCase()] || ((t: string) => t);
    const statusIcon = this.success ? chalk.green("●") : chalk.red("✖");
    const argsStr = this.formatArgs();
    const duration = this.duration_ms !== undefined ? `(${formatDuration(this.duration_ms)})` : "";

    const safeWidth = Math.max(20, width - 1);

    let headerAction = this.toolName;
    let headerTarget = `(${argsStr})`;
    
    const toolNameLower = this.toolName.toLowerCase();
    const isFileUpdate = ["write", "edit", "replace_file_content", "multi_replace_file_content"].includes(toolNameLower);
    const isFileRead = ["read", "view_file", "skill", "webfetch"].includes(toolNameLower);
    const isRun = ["bash", "run_command"].includes(toolNameLower);

    let filename: string | undefined = undefined;
    if (this.args) {
      filename = (this.args.TargetFile || this.args.file_path || this.args.file || this.args.AbsolutePath || this.args.filePath) as string;
    }

    if ((isFileUpdate || isFileRead) && filename) {
      headerAction = isFileUpdate ? "Update" : "Read";
      const cwd = process.cwd();
      const displayFile = filename.startsWith(cwd) ? filename.slice(cwd.length + 1) : filename;
      headerTarget = `(${displayFile}${formatLineRange(this.args)})`;
    } else if (isRun && this.args) {
      const cmdArg = (this.args.CommandLine || this.args.command || "") as string;
      if (cmdArg) {
        headerAction = "Run";
        // Heredocs and `node -e '…'` make the command multi-line; flatten it
        // the way formatArgs does so the header stays a single terminal row.
        headerTarget = `(${cmdArg.replace(/\s*\n\s*/g, " ")})`;
      }
    }

    const displayResult = this.unwrapOutput(this.result);
    // `looksLikeDiff` only tests for leading +/-, so any markdown bullet list
    // trips it — a README read as "Removed 6 lines". Read-type tools suppress
    // their body anyway, so they never take the diff branch.
    const isDiff = !isFileRead && !!displayResult && looksLikeDiff(displayResult);
    // `isFileRead` output is dropped below, so those never get a caret either.
    this.collapsible = !isDiff && !isFileRead && (!!displayResult || this.success);
    const collapsed = this.collapsible && this.isCollapsed;

    const lines: string[] = [];
    // A collapsed tool is one row in a stacked list, so it drops the blank
    // lines that frame an expanded block.
    if (!collapsed) lines.push(""); // Empty line above

    const caret = this.collapsible
      ? chalk.dim(this.isCollapsed ? "\u25b6 " : "\u25bc ")
      : "";
    let header = `${caret}${statusIcon} ${chalk.bold(colorFn(headerAction))}${headerTarget}`;
    if (duration) {
       header += ` ${chalk.dim(duration)}`;
    }

    header = truncateToWidth(header, safeWidth);
    this.headerLineIndex = lines.length;
    lines.push(header);

    if (collapsed) return lines;

    const resultWidth = safeWidth - 3; // 3 for "   " or "└─ "

    if (isDiff && displayResult) {
      const stats = getDiffStats(displayResult);
      let statText = "No changes";
      if (stats.added > 0 && stats.removed > 0) statText = `Added ${stats.added} line${stats.added === 1 ? "" : "s"}, removed ${stats.removed} line${stats.removed === 1 ? "" : "s"}`;
      else if (stats.added > 0) statText = `Added ${stats.added} line${stats.added === 1 ? "" : "s"}`;
      else if (stats.removed > 0) statText = `Removed ${stats.removed} line${stats.removed === 1 ? "" : "s"}`;

      lines.push(`${chalk.dim("└─")} ${statText}`);

      const colored = renderDiff(displayResult.replace(/\r/g, ""), resultWidth, filename);
      const preview = colored.slice(0, ToolResultMessage.MAX_DIFF_LINES);
      preview.forEach((raw) => {
        lines.push(`   ${raw}`);
      });
      const hidden = colored.length - preview.length;
      if (hidden > 0) {
        lines.push(`   ${chalk.dim(`… +${hidden} line${hidden === 1 ? "" : "s"}`)}`);
      }
    } else if (displayResult && !isFileRead) {
      const resultLines = displayResult.replace(/\r/g, "").split("\n");
      
      let highlightedLines = resultLines;
      const lang = getLanguageFromFilename(filename);
      if (lang && supportsLanguage(lang)) {
        try {
          const highlightedText = highlight(displayResult, { language: lang, theme: diffTheme });
          highlightedLines = highlightedText.split("\n");
        } catch (err) {
          // fallback
        }
      }

      const preview = highlightedLines.slice(0, ToolResultMessage.MAX_PREVIEW_LINES);
      
      if (isRun) {
        lines.push(`${chalk.dim("└─")} Output`);
      }
      
      preview.forEach((raw, i) => {
        const prefix = (i === 0 && !isRun) ? chalk.dim("└─") : "  ";
        lines.push(` ${prefix} ${truncateToWidth(raw, resultWidth)}`);
      });
      const hidden = resultLines.length - preview.length;
      if (hidden > 0) {
        lines.push(`    ${chalk.dim(`… +${hidden} line${hidden === 1 ? "" : "s"}`)}`);
      }
    } else if (this.success && !isFileRead) {
      lines.push(` ${chalk.dim("└─")} ${chalk.dim("(no output)")}`);
    }

    // A read prints no body — its header is the whole message. Framing that
    // one row with blank lines made a run of reads twice as tall as the
    // collapsed tools around it, so a bodyless row stays a single row.
    if (lines.length === this.headerLineIndex + 1) {
      this.headerLineIndex = 0;
      return [header];
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
