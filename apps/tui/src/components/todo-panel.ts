import {
  truncateToWidth,
  visibleWidth,
  type Component,
} from "@earendil-works/pi-tui";
import chalk from "chalk";

export type TodoPanelStatus = "pending" | "in_progress" | "completed";

export interface TodoPanelItem {
  status: TodoPanelStatus;
  content: string;
}

// Max todo rows shown before collapsing into a "+N more" line, so the pinned
// panel never grows unbounded on a long plan.
const MAX_ROWS = 14;

const MARKS: Record<TodoPanelStatus, string> = {
  completed: chalk.green("✔"),
  in_progress: chalk.yellow("▸"),
  pending: chalk.gray("○"),
};

/**
 * A fixed, always-on panel (rendered as a pi-tui overlay) that mirrors the
 * agent's current todo list on the right-middle of the screen. Data comes from
 * parsing `todowrite` tool-result output in the stream handler — this component
 * is pure presentation.
 */
export class TodoPanel implements Component {
  private items: TodoPanelItem[] = [];
  private cachedWidth?: number;
  private cachedLines?: string[];

  setItems(items: TodoPanelItem[]): void {
    this.items = items;
    this.invalidate();
  }

  count(): number {
    return this.items.length;
  }

  invalidate(): void {
    this.cachedWidth = undefined;
    this.cachedLines = undefined;
  }

  // Build one bordered content row: "│ <inner> │" padded to the box width.
  private row(inner: string, boxWidth: number): string {
    const avail = boxWidth - 1; // one leading space after the left border
    let text = inner;
    if (visibleWidth(text) > avail) text = truncateToWidth(text, avail);
    const pad = Math.max(0, avail - visibleWidth(text));
    return `│ ${text}${" ".repeat(pad)}│`;
  }

  render(width: number): string[] {
    if (this.cachedLines && this.cachedWidth === width) return this.cachedLines;

    const boxWidth = Math.max(0, width - 2); // inside the │ … │ borders
    const done = this.items.filter((i) => i.status === "completed").length;

    // Top border carries the title: ╭ Todos d/total ─…╮
    const titlePlain = ` Todos ${done}/${this.items.length} `;
    const dashes = Math.max(0, width - 2 - titlePlain.length);
    const top = `╭${chalk.bold(titlePlain)}${"─".repeat(dashes)}╮`;

    const lines: string[] = [top];
    const shown = this.items.slice(0, MAX_ROWS);
    for (const it of shown) {
      const label =
        it.status === "completed"
          ? chalk.dim.strikethrough(it.content)
          : it.status === "in_progress"
            ? chalk.white(it.content)
            : it.content;
      lines.push(this.row(`${MARKS[it.status]} ${label}`, boxWidth));
    }
    const extra = this.items.length - shown.length;
    if (extra > 0) lines.push(this.row(chalk.dim(`… +${extra} more`), boxWidth));
    lines.push(`╰${"─".repeat(boxWidth)}╯`);

    const out = lines.map((l) => truncateToWidth(l, width));
    this.cachedWidth = width;
    this.cachedLines = out;
    return out;
  }
}

// Parse the rendered `todowrite` result (marks defined in core's todo tool:
// "[x]" completed, "[~]" in progress, "[ ]" pending). Returns [] for an empty
// or cleared list so the caller can hide the panel.
export function parseTodoResult(result: string): TodoPanelItem[] {
  if (!result || result.includes("(todo list cleared)")) return [];
  const items: TodoPanelItem[] = [];
  for (const line of result.split("\n")) {
    const m = line.match(/^\s*\[(x|~| )\]\s+(.*\S)\s*$/);
    if (!m) continue;
    const status: TodoPanelStatus =
      m[1] === "x" ? "completed" : m[1] === "~" ? "in_progress" : "pending";
    items.push({ status, content: m[2] });
  }
  return items;
}
