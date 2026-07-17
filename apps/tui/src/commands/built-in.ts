import { registerCommand, type Command, type CommandContext } from "./index.js";
import { AVAILABLE_MODELS } from "../models.js";
import { restoreScreen } from "../terminal-screen.js";

const helpCommand: Command = {
  name: "help",
  description: "Show available commands",
  execute: (_args, ctx) => {
    ctx.showMessage(`**Available Commands:**

- **/help** - Show this help message
- **/clear** - Clear all messages
- **/model** - Select AI model
- **/resume** - Resume a previous session
- **/usage** - Show daily token usage heatmap
- **/exit** - Exit FreeCode

Use **PgUp/PgDn** to scroll the message history.
Just type your prompt to start chatting!`);
  },
};

const clearCommand: Command = {
  name: "clear",
  description: "Clear all messages",
  execute: (_args, ctx) => {
    ctx.showMessage("*Messages cleared*");
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

const usageCommand: Command = {
  name: "usage",
  description: "Show daily token usage heatmap",
  execute: async (_args, ctx) => {
    let data: any[] = [];
    try {
      const fs = await import("fs");
      const path = await import("path");
      const os = await import("os");
      const usagePath = path.join(os.homedir(), ".freecode", "usage.json");

      if (fs.existsSync(usagePath)) {
        const content = fs.readFileSync(usagePath, "utf-8");
        data = JSON.parse(content);
      } else {
        ctx.showMessage(
          `*No usage.json found at .freecode/usage.json. Showing heatmap with {} data.*`,
        );
        // Show empty heatmap
        data = [];
      }
    } catch (err) {
      ctx.showMessage(`*Error reading usage.json: ${err}*`);
      return;
    }

    ctx.showMessage(
      `*Launching interactive token usage heatmap... Press 'q' or 'Esc' to exit.*`,
    );

    const { startInteractiveHeatmap } = await import(
      "@thisisayande/terminal-heatmap"
    );
    await startInteractiveHeatmap(data, {
      title: "Daily Token Usage",
      preset: "double-block",
      countKey: "tokencount",
      allDayLabels: true,
      theme: {
        colors: ["#2d2d2d", "#82660a", "#C2990F", "#DCAE15", "#F5C71A"],
      },
    });

    // Restore pi-tui terminal state
    if (process.stdin.setRawMode) {
      process.stdin.setRawMode(true);
    }
    process.stdin.resume();
    process.stdout.write("\x1b[?25l"); // hide hardware cursor
  },
};

export function registerBuiltInCommands(): void {
  registerCommand(helpCommand);
  registerCommand(clearCommand);
  registerCommand(exitCommand);
  registerCommand(modelCommand);
  registerCommand(resumeCommand);
  registerCommand(usageCommand);
}
