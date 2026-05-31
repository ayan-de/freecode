import { Box, Markdown, Text, type Component } from "@earendil-works/pi-tui";
import chalk from "chalk";
import { defaultMarkdownTheme } from "../themes.js";
import type { MessageType } from "./message-types.js";

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
export function createInProgressMessageComponent(phrase: string): Component {
  const box = new Box(1, 1);
  const text = new Text(chalk.yellow(phrase), 1, 1);
  box.addChild(text);

  return box;
}

/**
 * Factory function to create the appropriate component based on message type
 */
export function createMessageComponent(type: MessageType, content: string): Component {
  switch (type) {
    case "user":
      return createUserMessageComponent(content);
    case "assistant":
      return createAssistantMessageComponent(content);
    case "system":
      return createSystemMessageComponent(content);
    case "in_progress":
      return createInProgressMessageComponent(content);
    default:
      return createSystemMessageComponent(content);
  }
}