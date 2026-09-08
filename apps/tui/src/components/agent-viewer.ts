import {
  Key,
  matchesKey,
  truncateToWidth,
  visibleWidth,
  type Component,
} from "@earendil-works/pi-tui";
import chalk from "chalk";
import type { AgentSummary } from "@thisisayande/freecode-shared";

const ACCENT = "#5FD7FF";
const DIM = "#666666";
/** Header, rule, hint. */
const CHROME_ROWS = 3;
const MIN_BODY_ROWS = 3;
const SCROLL_STEP = 5;

export interface AgentViewerCallbacks {
  /** Interrupt the agent being watched. */
  onStop: (agentId: string) => void;
  /** Hand the main area back to the main agent's transcript. */
  onBack: () => void;
}

function elapsed(agent: AgentSummary): string {
  const ms = (agent.endedAt ?? Date.now()) - agent.startedAt;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return s % 60 === 0 ? `${m}m` : `${m}m${String(s % 60).padStart(2, "0")}s`;
}

/**
 * AgentViewer — a subagent's live activity, rendered IN PLACE OF the main
 * transcript rather than inside a card.
 *
 * It takes the main area's slot in `tui.children` while a subagent is being
 * watched, which is why it is a plain viewport and carries no border: the
 * previous in-card detail pane had to fight the roster for six rows on a
 * terminal that had plenty, and read as a modal over the conversation rather
 * than a replacement for it.
 *
 * Unlike the message list this is a bounded window, not a growing transcript:
 * a live agent emits continuously and re-rendering its whole history on every
 * delta is what made watching one feel slow.
 */
export class AgentViewer implements Component {
  private agent: AgentSummary | null = null;
  private lines: string[] = [""];
  /** Rows scrolled up from the tail; 0 means "follow the live activity". */
  private scroll = 0;
  private maxRowsSource: () => number = () => 24;

  constructor(private readonly callbacks: AgentViewerCallbacks) {}

  setMaxRows(rows: number | (() => number)): void {
    this.maxRowsSource = typeof rows === "function" ? rows : () => rows;
  }

  /** Point the viewer at an agent, discarding the previous one's buffer. */
  open(agent: AgentSummary, activity: string): void {
    this.agent = agent;
    this.lines = activity.length > 0 ? activity.split("\n") : [""];
    this.scroll = 0;
  }

  /** Roster refresh — status and elapsed time only, never the buffer. */
  update(agent: AgentSummary | undefined): void {
    if (agent && this.agent && agent.id === this.agent.id) this.agent = agent;
  }

  agentId(): string | undefined {
    return this.agent?.id ?? undefined;
  }

  /** Live chunk from an `agent_output` stream event. */
  append(chunk: string): void {
    const parts = chunk.split("\n");
    this.lines[this.lines.length - 1] += parts[0];
    for (const part of parts.slice(1)) this.lines.push(part);
    // A viewport, not the archive — core's ring buffer is the source of truth.
    if (this.lines.length > 2000) {
      this.lines.splice(0, this.lines.length - 2000);
    }
  }

  private get bodyRows(): number {
    return Math.max(MIN_BODY_ROWS, this.maxRowsSource() - CHROME_ROWS);
  }

  render(width: number): string[] {
    const agent = this.agent;
    if (!agent) return [];
    const accent = (s: string): string => chalk.hex(ACCENT)(s);
    const dim = (s: string): string => chalk.hex(DIM)(s);

    const status =
      agent.status === "running"
        ? accent(`running ${elapsed(agent)}`)
        : dim(`${agent.status} ${elapsed(agent)}`);
    const label = `Subagent: ${agent.task.split("\n")[0]}`;
    const head = `${chalk.bold(truncateToWidth(label, Math.max(10, width - 24)))}  ${status}`;

    const rows: string[] = [head, accent("─".repeat(Math.max(0, width)))];

    const body = this.bodyRows;
    const maxScroll = Math.max(0, this.lines.length - body);
    if (this.scroll > maxScroll) this.scroll = maxScroll;
    const end = this.lines.length - this.scroll;
    const window = this.lines.slice(Math.max(0, end - body), end);
    if (window.length === 0 || (window.length === 1 && window[0] === "")) {
      rows.push(dim("(no activity yet)"));
    } else {
      for (const line of window) {
        rows.push(
          visibleWidth(line) > width ? truncateToWidth(line, width) : line,
        );
      }
    }

    rows.push(
      dim(
        [
          "esc back to main",
          "pgup/pgdn scroll",
          ...(this.scroll > 0 ? ["end follow"] : []),
          ...(agent.status === "running" ? ["k stop"] : []),
        ].join(" · "),
      ),
    );
    return rows;
  }

  handleInput(data: string): void {
    if (matchesKey(data, Key.escape) || data === "q") {
      this.callbacks.onBack();
      return;
    }
    if (matchesKey(data, Key.pageUp) || matchesKey(data, Key.up)) {
      this.scroll += SCROLL_STEP;
      return;
    }
    if (matchesKey(data, Key.pageDown) || matchesKey(data, Key.down)) {
      this.scroll = Math.max(0, this.scroll - SCROLL_STEP);
      return;
    }
    if (matchesKey(data, Key.end) || data === "G") {
      this.scroll = 0;
      return;
    }
    if (data === "k" && this.agent?.status === "running") {
      this.callbacks.onStop(this.agent.id);
    }
  }

  invalidate(): void {}
}
