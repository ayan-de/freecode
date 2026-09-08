import {
  Key,
  matchesKey,
  truncateToWidth,
  visibleWidth,
  type Component,
} from "@earendil-works/pi-tui";
import chalk from "chalk";
import type { AgentSummary } from "@thisisayande/freecode-shared";

// Card chrome matches ScrollableModal and the /shells card, a different accent
// so the two are told apart at a glance.
const ACCENT = "#5FD7FF";
const DIM = "#666666";
const PAD_X = 2;
/** Top border, hint, bottom border. */
const CHROME_ROWS = 3;
const MIN_INNER_WIDTH = 32;

export interface AgentsPanelCallbacks {
  /**
   * Open a row. `null` is the main row: hand the main area back to the
   * conversation. An id opens that subagent in place of it.
   */
  onOpen: (agentId: string | null) => void;
  onStop: (agentId: string) => void;
  /** Drop a settled agent from the roster. Core refuses a running one. */
  onRemove: (agentId: string) => void;
  onClose: () => void;
}

function elapsed(agent: AgentSummary): string {
  const ms = (agent.endedAt ?? Date.now()) - agent.startedAt;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return s % 60 === 0 ? `${m}m` : `${m}m${String(s % 60).padStart(2, "0")}s`;
}

/**
 * Status as a word, not a glyph. The card is a roster read at a glance and the
 * coloured bullets it used to carry were noise on top of a label that already
 * said the same thing.
 */
function statusCell(agent: AgentSummary): string {
  const text = `${agent.status === "completed" ? "done" : agent.status} ${elapsed(agent)}`;
  return agent.status === "running"
    ? chalk.hex(ACCENT)(text)
    : chalk.hex(DIM)(text);
}

/**
 * AgentsPanel — the `/agents` card. A ROSTER ONLY: the main agent on top, every
 * subagent it spawned indented beneath.
 *
 * Enter does not open a pane in here. It hands the id back to the shell, which
 * swaps the main area over to that agent (see `AgentViewer`) and closes this
 * card. A detail pane inside the card had to share a fixed-height box with the
 * roster, so watching an agent meant reading five rows through a letterbox
 * while the conversation sat behind it.
 *
 * Height is content-driven — a two-agent roster is a four-row card, not 60% of
 * the terminal.
 */
export class AgentsPanel implements Component {
  private agents: AgentSummary[] = [];
  /** 0 is the main agent; 1..n index into `agents`. */
  private selected = 0;
  private listScroll = 0;
  private maxRowsSource: () => number = () => 24;

  constructor(private readonly callbacks: AgentsPanelCallbacks) {}

  setMaxRows(rows: number | (() => number)): void {
    this.maxRowsSource = typeof rows === "function" ? rows : () => rows;
  }

  /** Replaces the roster, keeping the selection pinned to the same agent id. */
  setAgents(agents: AgentSummary[]): void {
    const previousId = this.agents[this.selected - 1]?.id;
    this.agents = agents;
    if (this.selected > 0) {
      const next = agents.findIndex((a) => a.id === previousId);
      this.selected =
        next >= 0 ? next + 1 : Math.min(this.selected, agents.length);
    }
    if (this.selected < 0) this.selected = 0;
  }

  /** Feeds the ModeLine chip, which is why it stays correct while closed. */
  runningCount(): number {
    return this.agents.filter((a) => a.status === "running").length;
  }

  isEmpty(): boolean {
    return this.agents.length === 0;
  }

  find(agentId: string): AgentSummary | undefined {
    return this.agents.find((a) => a.id === agentId);
  }

  /** The agent under the cursor, or undefined when the main row is selected. */
  selectedAgent(): AgentSummary | undefined {
    return this.selected > 0 ? this.agents[this.selected - 1] : undefined;
  }

  /** Rows the roster wants: main + every subagent, capped by the terminal. */
  private get listRows(): number {
    return Math.max(
      1,
      Math.min(this.agents.length + 1, this.maxRowsSource() - CHROME_ROWS),
    );
  }

  heightFor(width: number): number {
    void width;
    return this.listRows + CHROME_ROWS;
  }

  render(width: number): string[] {
    const inner = Math.max(MIN_INNER_WIDTH, width - 2);
    const bodyWidth = inner - PAD_X * 2;
    const accent = (s: string): string => chalk.hex(ACCENT)(s);
    const dim = (s: string): string => chalk.hex(DIM)(s);
    const border = accent("│");

    const row = (text: string): string => {
      const clipped =
        visibleWidth(text) > bodyWidth
          ? truncateToWidth(text, bodyWidth)
          : text;
      const fill = " ".repeat(Math.max(0, bodyWidth - visibleWidth(clipped)));
      const pad = " ".repeat(PAD_X);
      return `${border}${pad}${clipped}${fill}${pad}${border}`;
    };

    const entry = (
      label: string,
      meta: string,
      isSelected: boolean,
      depth: number,
    ): string => {
      const marker = isSelected ? accent("> ") : "  ";
      const indent = "  ".repeat(depth);
      const metaWidth = visibleWidth(meta);
      const labelWidth = Math.max(8, bodyWidth - metaWidth - 4 - indent.length);
      const text = truncateToWidth(label, labelWidth);
      const gap = " ".repeat(
        Math.max(
          1,
          bodyWidth - 2 - indent.length - visibleWidth(text) - metaWidth,
        ),
      );
      return `${marker}${indent}${isSelected ? chalk.bold(text) : text}${gap}${meta}`;
    };

    const rows: string[] = [];
    const title = " Agents ";
    rows.push(
      accent("╭─") +
        chalk.bold(title) +
        accent("─".repeat(Math.max(0, inner - visibleWidth(title) - 1)) + "╮"),
    );

    const running = this.runningCount();
    const entries: string[] = [
      entry(
        "main",
        running > 0
          ? chalk.hex(ACCENT)(`${running} running`)
          : dim(this.agents.length > 0 ? "idle" : "no subagents"),
        this.selected === 0,
        0,
      ),
      ...this.agents.map((agent) =>
        entry(
          agent.task.split("\n")[0],
          statusCell(agent),
          this.agents[this.selected - 1]?.id === agent.id,
          agent.depth,
        ),
      ),
    ];

    const listRows = this.listRows;
    if (this.selected < this.listScroll) this.listScroll = this.selected;
    if (this.selected >= this.listScroll + listRows) {
      this.listScroll = this.selected - listRows + 1;
    }
    for (const text of entries.slice(
      this.listScroll,
      this.listScroll + listRows,
    )) {
      rows.push(row(text));
    }

    // The hint names the action that applies to the CURRENT selection: `k stop`
    // on the main row would offer a key that does nothing.
    const sel = this.selectedAgent();
    const actions =
      sel === undefined
        ? ["enter main"]
        : sel.status === "running"
          ? ["enter watch", "k stop"]
          : ["enter open", "d dismiss"];
    rows.push(
      row(dim(["up/down select", ...actions, "esc close"].join(" · "))),
    );
    rows.push(accent("╰" + "─".repeat(inner) + "╯"));
    return rows;
  }

  handleInput(data: string): void {
    if (matchesKey(data, Key.escape) || data === "q") {
      this.callbacks.onClose();
      return;
    }
    if (matchesKey(data, Key.up)) {
      this.selected = Math.max(0, this.selected - 1);
      return;
    }
    if (matchesKey(data, Key.down)) {
      this.selected = Math.min(this.agents.length, this.selected + 1);
      return;
    }
    if (matchesKey(data, Key.enter) || data === "\r" || data === "\n") {
      this.callbacks.onOpen(this.selectedAgent()?.id ?? null);
      return;
    }
    if (data === "k") {
      const agent = this.selectedAgent();
      if (agent?.status === "running") this.callbacks.onStop(agent.id);
      return;
    }
    if (data === "d") {
      // Only a settled agent: dismissing a running one would leave the loop
      // running with nothing left holding a handle to interrupt it.
      const agent = this.selectedAgent();
      if (agent && agent.status !== "running")
        this.callbacks.onRemove(agent.id);
    }
  }

  invalidate(): void {}
}
