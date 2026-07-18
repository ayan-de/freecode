import {
  Box,
  Markdown,
  Text,
  truncateToWidth,
  type Component,
} from "@earendil-works/pi-tui";
import chalk from "chalk";
import { defaultMarkdownTheme } from "../themes.js";
import type { MessageType } from "./message-types.js";
import { formatTokenCount } from "../utils/format-tokens.js";

// Live output-token estimate for the streaming turn, fed from the streamed
// text length in index.ts (see setLiveOutputTokens). Used by the in-progress
// line while it has no final count yet, so the number tracks real generated
// tokens instead of a time-based guess.
let liveOutputTokens = 0;

/** Set the live output-token estimate for the currently streaming turn. */
export function setLiveOutputTokens(n: number): void {
  liveOutputTokens = n;
}

/** Clear the live output-token estimate at the start/end of a turn. */
export function resetLiveOutputTokens(): void {
  liveOutputTokens = 0;
}

/**
 * In-progress message component with live timer and token counts.
 * Renders "phrase (Xs) ↓inputTokens ↑outputTokens [████░░░░░ 50k/200k]"
 * Output tokens track the live streamed-text estimate until the final usage
 * arrives; input tokens show the real value once known (0 while streaming).
 */
class InProgressMessage implements Component {
  private phrase: string;
  private startTime: number;
  private baseInputTokens: number;
  private outputTokens: number;
  private contextLimit: number;
  private turns: number;
  private cachedTokens: number;

  constructor(
    phrase: string,
    startTime: number,
    baseInputTokens: number,
    outputTokens: number,
    contextLimit: number,
    turns: number,
    cachedTokens = 0,
  ) {
    this.phrase = phrase;
    this.startTime = startTime;
    this.baseInputTokens = baseInputTokens;
    this.outputTokens = outputTokens;
    this.contextLimit = contextLimit;
    this.turns = turns;
    this.cachedTokens = cachedTokens;
  }

  render(width: number): string[] {
    const elapsed = Math.floor((Date.now() - this.startTime) / 1000);
    // Output tracks the live streamed-text estimate until the final usage
    // lands (this.outputTokens > 0), at which point the real count wins.
    const outputTokens =
      this.outputTokens > 0 ? this.outputTokens : liveOutputTokens;
    const inStr = formatTokenCount(this.baseInputTokens);
    const outStr = formatTokenCount(outputTokens);
    let display = `${chalk.yellow(this.phrase)}${chalk.dim(` (${elapsed}s)`)} ${chalk.dim(`↓${inStr}`)} ${chalk.dim(`↑${outStr}`)}`;
    if (this.cachedTokens > 0) {
      display += ` ${chalk.dim(`cached: ${formatTokenCount(this.cachedTokens)}`)}`;
    }
    display += ` ${chalk.dim(`(x${this.turns})`)}`;

    if (this.contextLimit > 0) {
      const contextTokens =
        this.baseInputTokens + outputTokens + this.cachedTokens;
      const pct = Math.min(contextTokens / this.contextLimit, 1);
      const barWidth = Math.min(10, Math.max(3, Math.floor(width / 12)));
      const filled = Math.round(pct * barWidth);
      const empty = barWidth - filled;
      const bar = "█".repeat(filled) + "░".repeat(empty);
      const current = formatTokenCount(contextTokens);
      const limit = formatTokenCount(this.contextLimit);
      display += ` ${chalk.dim(`[${bar} ${current}/${limit}]`)}`;
    }

    // Always use a reasonable max width to ensure fit on all screens
    // 80 is safe minimum, but use actual width if reasonable
    // Subtract 1 to account for ANSI codes throwing off truncateToWidth
    const maxWidth = Math.max(40, Math.min(width, 200)) - 1;
    const truncated = truncateToWidth(display, maxWidth);
    return [truncated];
  }

  invalidate(): void {}

  getMinWidth(): number {
    return 10;
  }

  getMinHeight(): number {
    return 1;
  }

  addChild(_component: Component): void {}

  destroy(): void {}
}

// Regex to strip message prefixes (e.g., **You:** or **FreeCode:**)
const MESSAGE_PREFIX_RE = /^\*\*.*?:\*\*\s*/;

function stripPrefix(content: string): string {
  return content.replace(MESSAGE_PREFIX_RE, "");
}

/**
 * Wrapper that truncates child component output to fit available width.
 * Use this instead of hardcoding widths - respects actual terminal width.
 */
class WidthBounded implements Component {
  private inner: Component;

  constructor(inner: Component) {
    this.inner = inner;
  }

  render(width: number): string[] {
    const safeWidth = Math.max(20, width - 1);
    return this.inner
      .render(safeWidth)
      .map((line) => truncateToWidth(line, safeWidth));
  }

  invalidate(): void {
    if (typeof this.inner.invalidate === "function") this.inner.invalidate();
  }

  addChild(_component: Component): void {}
  destroy(): void {}
}

/**
 * Create a user message component — gray background with markdown content
 */
export function createUserMessageComponent(content: string): Component {
  const displayContent = stripPrefix(content);

  const box = new Box(0, 0, (text: string) => {
    const lines = text.split("\n");
    if (lines.length > 0 && lines[0].startsWith("  ")) {
      lines[0] = chalk.dim("❯") + lines[0].slice(1);
    }
    return lines
      .map((line) => chalk.bgRgb(50, 50, 50)(line))
      .join("\n");
  });
  const markdown = new Markdown(displayContent, 2, 0, defaultMarkdownTheme);
  box.addChild(markdown);

  const boundedBox = new WidthBounded(box);
  
  return {
    render(width: number): string[] {
      return [...boundedBox.render(width), ""];
    },
    invalidate() {
      if (typeof boundedBox.invalidate === "function") boundedBox.invalidate();
    },
    addChild() {},
    destroy() {},
  } as Component;
}

/**
 * Create an assistant message component — markdown with colored output
 */
export function createAssistantMessageComponent(content: string): Component {
  const displayContent = stripPrefix(content);

  const box = new Box(1, 1);
  const markdown = new Markdown(displayContent, 1, 1, defaultMarkdownTheme);
  box.addChild(markdown);

  return new WidthBounded(box);
}

export class ThinkingMessage implements Component {
  private content: string;
  private isCollapsed = false;
  private isDone = false;
  private startTime: number;
  private endTime?: number;

  constructor(content: string, startTime?: number) {
    this.content = content;
    this.startTime = startTime ?? Date.now();
  }

  get done(): boolean {
    return this.isDone;
  }

  updateContent(content: string) {
    this.content = content;
  }

  setDone() {
    this.isDone = true;
    this.endTime = Date.now();
  }

  toggle() {
    this.isCollapsed = !this.isCollapsed;
  }

  invalidate(): void {}

  render(width: number): string[] {
    const lines: string[] = [];
    const maxContentWidth = Math.max(20, width - 4);

    let header = "";
    if (!this.isDone) {
      header = chalk.yellow(this.isCollapsed ? "▶ Thinking..." : "▼ Thinking...");
    } else {
      const duration = this.endTime ? ((this.endTime - this.startTime) / 1000).toFixed(1) : "0.0";
      header = chalk.dim(this.isCollapsed ? `▶ Thought (${duration}s)` : `▼ Thought (${duration}s)`);
    }

    lines.push(header);

    if (!this.isCollapsed) {
      const rawLines = this.content.split("\n");
      for (const line of rawLines) {
        const truncated = truncateToWidth(line, maxContentWidth);
        const prefix = this.isDone ? chalk.dim("  │") : chalk.dim.yellow("  │");
        const text = this.isDone ? chalk.dim(truncated) : chalk.dim.yellow(truncated);
        lines.push(`${prefix} ${text}`);
      }
    }

    return lines;
  }

  getMinWidth(): number {
    return 10;
  }

  getMinHeight(): number {
    return 1;
  }

  addChild(_component: Component): void {}
  destroy(): void {}
}

/**
 * Create a thinking message component — yellow/dim yellow text with left-border decoration
 */
export function createThinkingMessageComponent(
  content: string,
  startTime?: number,
): Component {
  return new ThinkingMessage(content, startTime);
}
export function createSystemMessageComponent(content: string): Component {
  const displayContent = stripPrefix(content);

  const box = new Box(1, 1);
  const text = new Text(chalk.dim(displayContent), 1, 1);
  box.addChild(text);

  return new WidthBounded(box);
}

/**
 * Create an in-progress message component — dimmed yellow text (for "Simmering...", etc.)
 */
export function createInProgressMessageComponent(
  phrase: string,
  startTime: number,
  inputTokens: number,
  outputTokens: number,
  contextLimit: number,
  turns: number,
  cachedTokens = 0,
): Component {
  return new InProgressMessage(
    phrase,
    startTime,
    inputTokens,
    outputTokens,
    contextLimit,
    turns,
    cachedTokens,
  );
}

/**
 * Factory function to create the appropriate component based on message type
 */
export function createMessageComponent(
  type: MessageType,
  content: string,
  startTime?: number,
  inputTokens?: number,
  outputTokens?: number,
  contextLimit?: number,
  turns?: number,
  cachedTokens?: number,
): Component {
  switch (type) {
    case "user":
      return createUserMessageComponent(content);
    case "assistant":
      return createAssistantMessageComponent(content);
    case "system":
      return createSystemMessageComponent(content);
    case "thinking":
      return createThinkingMessageComponent(content, startTime);
    case "in_progress":
      return createInProgressMessageComponent(
        content,
        startTime ?? Date.now(),
        inputTokens ?? 0,
        outputTokens ?? 0,
        contextLimit ?? 0,
        turns ?? 1,
        cachedTokens ?? 0,
      );
    default:
      return createSystemMessageComponent(content);
  }
}
