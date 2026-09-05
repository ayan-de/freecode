import { registerCommand, type Command, type CommandContext } from "./index.js";
import { restoreScreen } from "../terminal-screen.js";
import {
  getUsage,
  graphExplore,
  listSkills,
  type DailyUsage,
  type SkillInfo,
} from "../ipc/client.js";

const helpCommand: Command = {
  name: "help",
  description: "Show available commands",
  execute: (_args, ctx) => {
    ctx.showMessage(`**Available Commands:**

- **/help** - Show this help message
- **/clear** - Clear all messages
- **/model** - Select an API model (uses your API key)
- **/web** - Select a web session (free, ask-only — no tools)
- **/effort** - Set reasoning effort (low/medium/high/xhigh/max)
- **/resume** - Resume a previous session
- **/compact** - Summarize older turns to free up context
- **/context** - Show what is occupying the context window
- **/usage** - Show daily token usage heatmap
- **/cost** - Show token spend and prompt-cache hit rate
- **/skills** - List available skills (global + project)
- **/graph** - Open the memory knowledge graph in your browser
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
  description: "Select an API model (uses your API key)",
  execute: (_args, ctx) => {
    ctx.showModelSelector?.();
  },
};

const webCommand: Command = {
  name: "web",
  description: "Select a web session (free, ask-only — no tools)",
  execute: (_args, ctx) => {
    ctx.showWebSelector?.();
  },
};

const mcpCommand: Command = {
  name: "mcp",
  description: "Manage MCP servers",
  execute: async (_args, ctx) => {
    if (ctx.showMcpPicker) {
      await ctx.showMcpPicker();
    } else {
      ctx.showMessage("MCP picker unavailable in this context.");
    }
  },
};

const effortCommand: Command = {
  name: "effort",
  description: "Set reasoning effort (low/medium/high/xhigh/max)",
  execute: (_args, ctx) => {
    ctx.showEffortPicker?.();
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

const contextCommand: Command = {
  name: "context",
  description: "Show what is occupying the context window",
  execute: async (_args, ctx) => {
    await ctx.showContextReport?.();
  },
};

const costCommand: Command = {
  name: "cost",
  description: "Show token spend and prompt-cache hit rate",
  execute: async (_args, ctx) => {
    await ctx.showCostReport?.();
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

export function registerBuiltInCommands(): void {
  registerCommand(helpCommand);
  registerCommand(clearCommand);
  registerCommand(exitCommand);
  registerCommand(modelCommand);
  registerCommand(webCommand);
  registerCommand(mcpCommand);
  registerCommand(effortCommand);
  registerCommand(resumeCommand);
  registerCommand(compactCommand);
  registerCommand(contextCommand);
  registerCommand(usageCommand);
  registerCommand(costCommand);
  registerCommand(skillsCommand);
  registerCommand(graphCommand);
}
