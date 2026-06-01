import { Box, Markdown, Text, truncateToWidth, type Component } from "@earendil-works/pi-tui";
import chalk from "chalk";
import { defaultMarkdownTheme } from "../themes.js";
import type { MessageType } from "./message-types.js";
import { formatTokenCount } from "../utils/format-tokens.js";

/**
 * In-progress message component with live timer and token counts.
 * Renders "phrase (Xs) ↓inputTokens ↑outputTokens [████░░░░░ 50k/200k]"
 * Input tokens are estimated live based on elapsed time (~1k tokens per second).
 */
class InProgressMessage implements Component {
  private phrase: string;
  private startTime: number;
  private baseInputTokens: number;
  private outputTokens: number;
  private contextLimit: number;
  private turns: number;

  constructor(phrase: string, startTime: number, baseInputTokens: number, outputTokens: number, contextLimit: number, turns: number) {
    this.phrase = phrase;
    this.startTime = startTime;
    this.baseInputTokens = baseInputTokens;
    this.outputTokens = outputTokens;
    this.contextLimit = contextLimit;
    this.turns = turns;
  }

  render(_width: number): string[] {
    const elapsed = Math.floor((Date.now() - this.startTime) / 1000);
    // Estimate: ~1k tokens per second of processing (rough approximation)
    const estimatedInputTokens = this.baseInputTokens + (elapsed * 1000);
    const inStr = formatTokenCount(estimatedInputTokens);
    const outStr = formatTokenCount(this.outputTokens);
    let display = `${chalk.yellow(this.phrase)}${chalk.dim(` (${elapsed}s)`)} ${chalk.dim(`↓${inStr}`)} ${chalk.dim(`↑${outStr}`)} ${chalk.dim(`(x${this.turns})`)}`;

    if (this.contextLimit > 0) {
      const pct = Math.min(estimatedInputTokens / this.contextLimit, 1);
      const barWidth = 10;
      const filled = Math.round(pct * barWidth);
      const empty = barWidth - filled;
      const bar = '█'.repeat(filled) + '░'.repeat(empty);
      const current = formatTokenCount(estimatedInputTokens);
      const limit = formatTokenCount(this.contextLimit);
      display += ` ${chalk.dim(`[${bar} ${current}/${limit}]`)}`;
    }

    // Truncate to terminal width (180 default, use actual width if provided)
    const maxWidth = _width > 0 ? _width : 180;
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
 * Create a user message component — gray background with markdown content
 */
export function createUserMessageComponent(content: string): Component {
  const displayContent = stripPrefix(content);

  const box = new Box(0, 0, (text: string) => {
    return text
      .split("\n")
      .map((line) => chalk.bgRgb(80, 80, 80)(line))
      .join("\n");
  });

  const markdown = new Markdown(displayContent, 1, 1, defaultMarkdownTheme);
  box.addChild(markdown);

  return box;
}

/**
 * Create an assistant message component — markdown with colored output (headings=cyan, code=yellow, etc.)
 */
export function createAssistantMessageComponent(content: string): Component {
  const displayContent = stripPrefix(content);

  const box = new Box(1, 1);
  const markdown = new Markdown(displayContent, 1, 1, defaultMarkdownTheme);
  box.addChild(markdown);

  return box;
}

/**
 * Create a system message component — dimmed text (for errors, elapsed time, etc.)
 */
export function createSystemMessageComponent(content: string): Component {
  const displayContent = stripPrefix(content);

  const box = new Box(1, 1);
  const text = new Text(chalk.dim(displayContent), 1, 1);
  box.addChild(text);

  return box;
}

/**
 * Create an in-progress message component — dimmed yellow text (for "Simmering...", etc.)
 */
export function createInProgressMessageComponent(phrase: string, startTime: number, inputTokens: number, outputTokens: number, contextLimit: number, turns: number): Component {
  return new InProgressMessage(phrase, startTime, inputTokens, outputTokens, contextLimit, turns);
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
  turns?: number
): Component {
  switch (type) {
    case "user":
      return createUserMessageComponent(content);
    case "assistant":
      return createAssistantMessageComponent(content);
    case "system":
      return createSystemMessageComponent(content);
    case "in_progress":
      return createInProgressMessageComponent(
        content,
        startTime ?? Date.now(),
        inputTokens ?? 0,
        outputTokens ?? 0,
        contextLimit ?? 0,
        turns ?? 1
      );
    default:
      return createSystemMessageComponent(content);
  }
}
