import { Component, truncateToWidth } from "@earendil-works/pi-tui";
import chalk from "chalk";
import { ToolResultMessage, type ToolResultMessageOptions } from "./tool-result-message.js";
import { formatDuration } from "../utils/format-duration.js";

/**
 * Verb + noun used to describe a run of calls to one tool: `Read 2 files`.
 * Tools absent from the table fall back to `Name ×N`, so an MCP tool nobody
 * anticipated still summarizes without inventing English for it.
 */
const TOOL_PHRASES: Record<string, [verb: string, noun: string]> = {
  read: ["Read", "file"],
  view_file: ["Read", "file"],
  write: ["Updated", "file"],
  edit: ["Updated", "file"],
  replace_file_content: ["Updated", "file"],
  multi_replace_file_content: ["Updated", "file"],
  bash: ["Ran", "command"],
  run_command: ["Ran", "command"],
  grep: ["Searched", "pattern"],
  glob: ["Searched", "pattern"],
  ls: ["Listed", "directory"],
  webfetch: ["Fetched", "page"],
  websearch: ["Searched", "query"],
  todowrite: ["Updated", "todo list"],
  skill: ["Ran", "skill"],
  agent: ["Ran", "subagent"],
  memory: ["Saved", "memory"],
  lsp: ["Queried", "symbol"],
  question: ["Asked", "question"],
};

function pluralize(noun: string, count: number): string {
  if (count === 1) return noun;
  if (/[^aeiou]y$/.test(noun)) return `${noun.slice(0, -1)}ies`;
  return `${noun}s`;
}

/** Rows the group owns: its own summary, a child's row, or spacing. */
type LineOwner = "summary" | { item: ToolResultMessage; local: number } | null;

/**
 * A contiguous run of finished tool calls, rendered as one line.
 *
 * The group is collapsed from the start: while the turn runs, its
 * `Read 2 files, Updated 5 files` summary grows in place as calls finish.
 * Sealing it (the next thinking block, or the assistant's reply) only ends
 * the run so the next call starts a fresh group. A click puts the individual
 * calls back, and each of those still expands to its own output.
 */
export class ToolGroupMessage implements Component {
  private items: ToolResultMessage[] = [];
  private entries: ToolResultMessageOptions[] = [];
  private sealed = false;
  private expanded = false;
  private lineOwners: LineOwner[] = [];

  add(options: ToolResultMessageOptions): ToolResultMessage {
    const item = new ToolResultMessage(options);
    this.items.push(item);
    this.entries.push(options);
    return item;
  }

  /** Closes the group so the next tool call starts a fresh one. */
  seal(): void {
    this.sealed = true;
  }

  get isSealed(): boolean {
    return this.sealed;
  }

  get size(): number {
    return this.items.length;
  }

  invalidate(): void {
    for (const item of this.items) item.invalidate();
  }

  toggle(): void {
    this.expanded = !this.expanded;
  }

  /**
   * Clicking the summary folds the group; clicking a child's header folds that
   * one call. Every other row is left alone so drag-select still works over
   * expanded output.
   */
  toggleAt(local: number): void {
    const owner = this.lineOwners[local];
    if (owner === "summary") this.toggle();
    else if (owner) owner.item.toggle();
  }

  isToggleLine(local: number): boolean {
    const owner = this.lineOwners[local];
    if (owner === "summary") return true;
    return !!owner && owner.item.isToggleLine(owner.local);
  }

  render(width: number): string[] {
    const expanded = this.expanded;
    const lines: string[] = [];
    this.lineOwners = [];

    const push = (line: string, owner: LineOwner) => {
      lines.push(line);
      this.lineOwners.push(owner);
    };

    push("", null);

    const failed = this.entries.filter((e) => !e.success).length;
    const icon = failed > 0 ? chalk.red("✖") : chalk.green("●");
    const caret = chalk.dim(expanded ? "▼ " : "▶ ");
    let summary = `${caret}${icon} ${this.summaryText()}`;
    if (failed > 0) {
      summary += ` ${chalk.red(`(${failed} failed)`)}`;
    }
    const total = this.entries.reduce((sum, e) => sum + (e.duration_ms ?? 0), 0);
    if (total > 0) {
      summary += ` ${chalk.dim(`(${formatDuration(total)})`)}`;
    }
    push(truncateToWidth(summary, Math.max(20, width - 1)), "summary");

    if (!expanded) return lines;

    for (const item of this.items) {
      const rendered = item.render(width);
      // An expanded ToolResultMessage frames its body with blank lines for
      // standalone use; inside the group's stacked list those frames read as
      // stray gaps around the expanded call. Trim them — but keep each kept
      // row's ORIGINAL local index, since isToggleLine/toggleAt address the
      // child's own line numbering (its headerLineIndex in particular).
      let start = 0;
      let end = rendered.length;
      while (start < end && rendered[start] === "") start++;
      while (end > start && rendered[end - 1] === "") end--;
      for (let local = start; local < end; local++) {
        push(rendered[local]!, { item, local });
      }
    }
    return lines;
  }

  /** `Read 2 files, Updated 5 files` — buckets in first-seen order. */
  private summaryText(): string {
    const buckets: { label: (n: number) => string; count: number }[] = [];
    const byKey = new Map<string, (typeof buckets)[number]>();

    for (const entry of this.entries) {
      const phrase = TOOL_PHRASES[entry.toolName.toLowerCase()];
      const key = phrase ? phrase.join(" ") : `raw:${entry.toolName}`;
      let bucket = byKey.get(key);
      if (!bucket) {
        bucket = {
          count: 0,
          label: phrase
            ? (n: number) => `${phrase[0]} ${n} ${pluralize(phrase[1], n)}`
            : (n: number) => `${entry.toolName} ×${n}`,
        };
        byKey.set(key, bucket);
        buckets.push(bucket);
      }
      bucket.count++;
    }

    return buckets.map((b) => chalk.bold(b.label(b.count))).join(chalk.dim(", "));
  }
}
