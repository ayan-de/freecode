import type { CommandInfo } from "@thisisayande/freecode-shared";
import type { PromptCommand, UserCommand } from "./types.js";
import { initTemplate } from "./templates/init.js";
import { loadCommands, resolveUserCommand } from "./loader.js";

// Built-in prompt commands. Add new entries here — every frontend picks them up
// via IPC (commands.list / commands.resolve). No frontend changes required.
const builtinCommands = new Map<string, PromptCommand>();

function registerBuiltin(cmd: PromptCommand): void {
  builtinCommands.set(cmd.name, cmd);
}

registerBuiltin({
  name: "init",
  description: "Analyze the repo and generate AGENTS.md / CLAUDE.md",
  argHint: "[focus]",
  template: initTemplate,
});

// In-memory cache of loaded user commands (refreshed on demand)
let userCommandsCache: UserCommand[] | null = null;
let lastLoadedProjectPath: string | null = null;

/** Load and cache user commands for a project. */
async function ensureUserCommandsLoaded(projectPath: string): Promise<void> {
  if (userCommandsCache && lastLoadedProjectPath === projectPath) {
    return;
  }
  userCommandsCache = await loadCommands({ projectPath });
  lastLoadedProjectPath = projectPath;
}

/** Clear the user commands cache (useful for testing). */
export function clearCommandsCache(): void {
  userCommandsCache = null;
  lastLoadedProjectPath = null;
}

/** Metadata for every prompt command (for autocomplete / menus). */
export async function listCommandInfos(projectPath: string): Promise<CommandInfo[]> {
  await ensureUserCommandsLoaded(projectPath);
  // Use a Map to handle precedence correctly: later inserts overwrite earlier ones
  // Order: builtin → user → project (project wins on name collision)
  const commandMap = new Map<string, CommandInfo>();

  // Built-in commands (lowest precedence)
  for (const c of builtinCommands.values()) {
    commandMap.set(c.name, {
      name: c.name,
      description: c.description,
      argHint: c.argHint,
    });
  }

  // User commands (medium precedence - overwrite builtins)
  if (userCommandsCache) {
    for (const c of userCommandsCache.filter((cmd) => cmd.scope === "user")) {
      commandMap.set(c.name, {
        name: c.name,
        description: c.description,
        argHint: c.argHint,
      });
    }
  }

  // Project commands (highest precedence - overwrite user/builtin)
  if (userCommandsCache) {
    for (const c of userCommandsCache.filter((cmd) => cmd.scope === "project")) {
      commandMap.set(c.name, {
        name: c.name,
        description: c.description,
        argHint: c.argHint,
      });
    }
  }

  return Array.from(commandMap.values());
}

/**
 * Resolve a command to the prompt string sent to the agent, or null if unknown.
 * Precedence: Project > User > Built-in
 */
export async function resolveCommand(
  name: string,
  args: string[],
  cwd: string,
  projectPath: string,
): Promise<string | null> {
  // Load user commands first (project and user)
  await ensureUserCommandsLoaded(projectPath);

  // Check project commands (highest precedence)
  if (userCommandsCache) {
    const projectCmd = userCommandsCache.find(
      (c) => c.scope === "project" && c.name === name,
    );
    if (projectCmd) {
      return resolveUserCommand(projectCmd, { cwd, args });
    }
  }

  // Check user commands (medium precedence)
  if (userCommandsCache) {
    const userCmd = userCommandsCache.find(
      (c) => c.scope === "user" && c.name === name,
    );
    if (userCmd) {
      return resolveUserCommand(userCmd, { cwd, args });
    }
  }

  // Check built-in commands (lowest precedence)
  const builtin = builtinCommands.get(name);
  if (builtin) {
    return builtin.template({ cwd, args });
  }

  return null;
}

/** Get all loaded user commands (for debugging/inspection). */
export function getUserCommands(): UserCommand[] {
  return userCommandsCache || [];
}
