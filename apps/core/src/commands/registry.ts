import type { CommandInfo } from "@thisisayande/freecode-shared";
import type { PromptCommand } from "./types.js";
import { initTemplate } from "./templates/init.js";

// Built-in prompt commands. Add new entries here — every frontend picks them up
// via IPC (commands.list / commands.resolve). No frontend changes required.
const commands = new Map<string, PromptCommand>();

function register(cmd: PromptCommand): void {
  commands.set(cmd.name, cmd);
}

register({
  name: "init",
  description: "Analyze the repo and generate AGENTS.md / CLAUDE.md",
  argHint: "[focus]",
  template: initTemplate,
});

/** Metadata for every prompt command (for autocomplete / menus). */
export function listCommandInfos(): CommandInfo[] {
  return Array.from(commands.values()).map((c) => ({
    name: c.name,
    description: c.description,
    argHint: c.argHint,
  }));
}

/** Resolve a command to the prompt string sent to the agent, or null if unknown. */
export function resolveCommand(
  name: string,
  args: string[],
  cwd: string,
): string | null {
  const cmd = commands.get(name);
  if (!cmd) return null;
  return cmd.template({ cwd, args });
}
