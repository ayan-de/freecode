import { Chalk } from "chalk";
import type {
  EditorTheme,
  MarkdownTheme,
  SelectListTheme,
} from "@earendil-works/pi-tui";

const chalk = new Chalk({ level: 3 });

export const defaultSelectListTheme: SelectListTheme = {
  selectedPrefix: (text: string) => chalk.blue(text),
  selectedText: (text: string) => chalk.bold(text),
  description: (text: string) => chalk.dim(text),
  scrollInfo: (text: string) => chalk.dim(text),
  noMatch: (text: string) => chalk.dim(text),
};

export const defaultMarkdownTheme: MarkdownTheme = {
  heading: (text: string) => chalk.bold.cyan(text),
  link: (text: string) => chalk.blue(text),
  linkUrl: (text: string) => chalk.dim(text),
  code: (text: string) => chalk.yellow(text),
  codeBlock: (text: string) => chalk.green(text),
  codeBlockBorder: (text: string) => chalk.dim(text),
  quote: (text: string) => chalk.italic(text),
  quoteBorder: (text: string) => chalk.dim(text),
  hr: (text: string) => chalk.dim(text),
  listBullet: (text: string) => chalk.cyan(text),
  bold: (text: string) => chalk.bold(text),
  italic: (text: string) => chalk.italic(text),
  strikethrough: (text: string) => chalk.strikethrough(text),
  underline: (text: string) => chalk.underline(text),
};

export const defaultEditorTheme: EditorTheme = {
  borderColor: (text: string) => chalk.yellowBright(text),
  selectList: defaultSelectListTheme,
};

export const MODE_COLORS: Record<
  "plan" | "build" | "review" | "explore" | "danger",
  (text: string) => string
> = {
  plan: (text: string) => chalk.blueBright(text),
  build: (text: string) => chalk.yellowBright(text),
  review: (text: string) => chalk.greenBright(text),
  explore: (text: string) => chalk.magentaBright(text),
  danger: (text: string) => chalk.redBright(text),
};

export const MODE_BG_COLORS: Record<
  "plan" | "build" | "review" | "explore" | "danger",
  (text: string) => string
> = {
  plan: (text: string) => chalk.bgHex("#5B9BD5")(text), // bright blue
  build: (text: string) => chalk.bgHex("#FFD700")(text), // bright yellow
  review: (text: string) => chalk.bgHex("#3CFB3C")(text), // bright green
  explore: (text: string) => chalk.bgHex("#D92688")(text), // bright magenta
  danger: (text: string) => chalk.bgHex("#FF4444")(text), // bright red
};
