import { registerCommand, type Command, type CommandContext } from "./index.js";
import { AVAILABLE_MODELS } from "../models.js";
import { restoreScreen } from "../terminal-screen.js";
import {
  getUsage,
  graphExplore,
  harnessHistory,
  harnessList,
  listSkills,
  type DailyUsage,
  type DistillResultInfo,
  type HarnessEntryInfo,
  type SkillInfo,
} from "../ipc/client.js";
import { renderCostReport } from "../utils/cost-report.js";

const helpCommand: Command = {
  name: "help",
  description: "Show available commands",
  execute: (_args, ctx) => {
    ctx.showMessage(`**Available Commands:**

- **/help** - Show this help message
- **/clear** - Clear all messages
- **/model** - Select AI model
- **/resume** - Resume a previous session
- **/compact** - Summarize older turns to free up context
- **/usage** - Show daily token usage heatmap
- **/cost** - Show token spend and prompt-cache hit rate
- **/skills** - List available skills (global + project)
- **/graph** - Open the memory knowledge graph in your browser
- **/harness** - Show the continual harness (what the agent has recorded)
- **/exit** - Exit FreeCode

Use **PgUp/PgDn** to scroll the message history.
Just type your prompt to start chatting!`);
  },
};

const clearCommand: Command = {
  name: "clear",
  description: "Clear the transcript and start a fresh session",
  execute: async (_args, ctx) => {
    // This used to print "*Messages cleared*" and do nothing else — neither the
    // transcript nor the session was touched, so the whole conversation kept
    // being re-sent on every later request. The reset in core is the point.
    await ctx.clearSession?.();
  },
};

const exitCommand: Command = {
  name: "exit",
  description: "Exit FreeCode",
  execute: () => {
    restoreScreen();
    process.exit(0);
  },
};

const modelCommand: Command = {
  name: "model",
  description: "Select AI model",
  execute: (_args, ctx) => {
    ctx.showModelSelector?.();
  },
};

const resumeCommand: Command = {
  name: "resume",
  description: "Resume a previous session",
  execute: (_args, ctx) => {
    ctx.showMessage(`**Select a session to resume:**`);
    ctx.showResumePicker?.();
  },
};

const compactCommand: Command = {
  name: "compact",
  description: "Summarize older turns to free up context",
  execute: (_args, ctx) => {
    void ctx.compactSession?.();
  },
};

const costCommand: Command = {
  name: "cost",
  description: "Show token spend and prompt-cache hit rate",
  execute: async (_args, ctx) => {
    let data: DailyUsage[] = [];
    try {
      data = await getUsage();
    } catch (err) {
      ctx.showMessage(`*Error fetching usage: ${err}*`);
      return;
    }
    ctx.showMessage(renderCostReport(data, ctx.getSessionUsage?.()));
  },
};

const usageCommand: Command = {
  name: "usage",
  description: "Show daily token usage heatmap",
  execute: async (_args, ctx) => {
    // Core owns the usage store; the TUI only renders what it hands back.
    let data: { date: string; tokencount: number }[] = [];
    try {
      data = await getUsage();
    } catch (err) {
      ctx.showMessage(`*Error fetching usage: ${err}*`);
      return;
    }
    if (data.length === 0) {
      ctx.showMessage(`*No usage recorded yet. Showing an empty heatmap.*`);
    }

    const { startInteractiveHeatmap } = await import(
      "@thisisayande/terminal-heatmap"
    );

    const launch = () =>
      startInteractiveHeatmap(data, {
        title: "Daily Token Usage",
        preset: "double-block",
        countKey: "tokencount",
        allDayLabels: true,
        theme: {
          colors: ["#2d2d2d", "#82660a", "#C2990F", "#DCAE15", "#F5C71A"],
        },
      });

    // The heatmap is an alternate-screen UI that owns the terminal + stdin.
    // pi-tui must release the terminal while it runs, otherwise its render
    // loop paints over the heatmap and the Kitty keyboard protocol swallows
    // the q/Esc/Ctrl+C exit keys. runFullscreen handles detach/re-attach.
    if (ctx.runFullscreen) {
      await ctx.runFullscreen(launch);
    } else {
      await launch();
    }
  },
};

// Human-friendly grouping order + labels for skill scopes.
const SKILL_SCOPE_ORDER = ["repo", "user", "plugin", "system", "admin"] as const;
const SKILL_SCOPE_LABELS: Record<string, string> = {
  repo: "Project",
  user: "Global",
  plugin: "Plugins",
  system: "System",
  admin: "Admin",
};

const skillsCommand: Command = {
  name: "skills",
  description: "List available skills (global + project)",
  execute: async (_args, ctx) => {
    // Core owns discovery; the TUI only renders what it hands back.
    let skills: SkillInfo[] = [];
    try {
      skills = await listSkills();
    } catch (err) {
      ctx.showMessage(`*Error fetching skills: ${err}*`);
      return;
    }

    if (skills.length === 0) {
      ctx.showMessage(
        "*No skills found.* Add one at `.freecode/skills/<name>/SKILL.md` (project) or `~/.freecode/skills/<name>/SKILL.md` (global). Claude skills in `~/.claude/skills` and installed plugins are picked up too.",
      );
      return;
    }

    const groups = new Map<string, SkillInfo[]>();
    for (const skill of skills) {
      const list = groups.get(skill.scope) ?? [];
      list.push(skill);
      groups.set(skill.scope, list);
    }

    const lines = [`**Available Skills** (${skills.length})`, ""];
    for (const scope of SKILL_SCOPE_ORDER) {
      const list = groups.get(scope);
      if (!list || list.length === 0) continue;
      lines.push(`**${SKILL_SCOPE_LABELS[scope] ?? scope}** (${list.length})`);
      for (const skill of list.sort((a, b) => a.name.localeCompare(b.name))) {
        lines.push(
          `- **${skill.name}**${skill.description ? ` — ${skill.description}` : ""}`,
        );
      }
      lines.push("");
    }
    lines.push(
      "_The model loads a skill on demand via the `skill` tool when a task matches its description._",
    );
    ctx.showMessage(lines.join("\n"));
  },
};

// Open the optional graph explorer in a separate browser window. Unlike
// /usage's fullscreen heatmap, this doesn't touch the terminal at all — the
// browser is a separate window and the TUI keeps working normally.
const graphCommand: Command = {
  name: "graph",
  description: "Open the memory knowledge graph in your browser",
  execute: async (_args, ctx) => {
    try {
      const result = await graphExplore();
      if ("error" in result) {
        ctx.showMessage(
          "**Graph explorer UI not installed.**\n\n" +
            "Run this in a terminal to download it once (~280 KB):\n\n" +
            "```\nfreecode memory ui-install\n```\n\n" +
            "Then run **/graph** again — the server checks the addon at request time, " +
            "no restart needed.",
        );
        return;
      }
      ctx.showMessage(`Graph explorer running at **${result.url}**`);
    } catch (err) {
      ctx.showMessage(
        `*Error opening graph explorer: ${err instanceof Error ? err.message : String(err)}*`,
      );
    }
  },
};

// The audit UI for the continual harness (spec 2026-08-08 §5.4: "an
// unreadable self-modifying store is not shippable"). Read-only on purpose —
// editing and rolling back go through the `distill` tool, which is
// permission-gated; a slash command that silently rewrote persistent agent
// state would be the one path around that gate.
const harnessCommand: Command = {
  name: "harness",
  description: "Show the continual harness (what the agent has recorded)",
  execute: async (_args, ctx) => {
    const sessionId = ctx.getSessionId?.();
    let entries: HarnessEntryInfo[];
    let history: DistillResultInfo[];
    try {
      [entries, history] = await Promise.all([
        harnessList(sessionId),
        harnessHistory(sessionId),
      ]);
    } catch (err) {
      ctx.showMessage(`*Error reading harness: ${err}*`);
      return;
    }

    if (entries.length === 0 && history.length === 0) {
      ctx.showMessage(
        "*The continual harness is empty.*\n\n" +
          "It fills up when the agent calls **distill** after learning something durable " +
          "(or when you run **/distill**). Off unless `harness.enabled` is true in " +
          "`.freecode/settings.json`.",
      );
      return;
    }

    const lines = [`**Continual Harness** (${entries.length} entries)`, ""];
    const byKind = new Map<string, HarnessEntryInfo[]>();
    for (const entry of entries) {
      const list = byKind.get(entry.kind) ?? [];
      list.push(entry);
      byKind.set(entry.kind, list);
    }
    for (const [kind, list] of [...byKind].sort()) {
      lines.push(`**${kind}** (${list.length})`);
      for (const entry of list.sort((a, b) => a.id.localeCompare(b.id))) {
        lines.push(
          `- \`${entry.scope}:${entry.id}\` **${entry.title}** _(v${entry.version})_`,
        );
        lines.push(`  ${entry.content.replace(/\s+/g, " ").trim()}`);
      }
      lines.push("");
    }

    if (history.length > 0) {
      lines.push(`**History** (${history.length})`);
      // Newest first, capped — the full log lives in harness_state.json.
      for (const event of [...history].reverse().slice(0, 10)) {
        const applied = event.appliedEdits.filter((e) => e.applied).length;
        const failed = event.appliedEdits.length - applied;
        lines.push(
          `- \`${event.id}\` (${event.scope}) ${event.summary} — ${applied} applied` +
            (failed > 0 ? `, ${failed} rejected` : "") +
            (event.rollbackOf ? ` _(rollback of ${event.rollbackOf})_` : ""),
        );
      }
      lines.push("");
      lines.push(
        "_Undo one with the `distill` tool's `rollback_id`, e.g. “roll back <id>”._",
      );
    }
    ctx.showMessage(lines.join("\n"));
  },
};

export function registerBuiltInCommands(): void {
  registerCommand(helpCommand);
  registerCommand(clearCommand);
  registerCommand(exitCommand);
  registerCommand(modelCommand);
  registerCommand(resumeCommand);
  registerCommand(compactCommand);
  registerCommand(usageCommand);
  registerCommand(costCommand);
  registerCommand(skillsCommand);
  registerCommand(graphCommand);
  registerCommand(harnessCommand);
}
