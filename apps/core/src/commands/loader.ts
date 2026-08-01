import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import fg from "fast-glob";
import type { UserCommand, CommandScope, CommandResolveContext } from "./types.js";
import { logger } from "../utils/logger.js";

const COMMAND_FILENAME = "command.md";
const FRONTMATTER_REGEX = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/;

// ============================================================================
// YAML Frontmatter Parser (mirrors skills/loader.ts)
// ============================================================================

function parseFrontmatter(
  content: string,
): { metadata: Record<string, string>; body: string } | null {
  const match = content.match(FRONTMATTER_REGEX);
  if (!match) return null;

  const frontmatterStr = match[1];
  const body = match[2].trim();

  const metadata: Record<string, string> = {};
  for (const line of frontmatterStr.split("\n")) {
    const colonIndex = line.indexOf(":");
    if (colonIndex === -1) continue;
    const key = line.slice(0, colonIndex).trim();
    const value = line
      .slice(colonIndex + 1)
      .trim()
      .replace(/^["']|["']$/g, "");
    metadata[key] = value;
  }

  return { metadata, body };
}

// ============================================================================
// Command File Parser
// ============================================================================

export function parseCommandFile(
  filePath: string,
  scope: CommandScope,
): UserCommand | null {
  let content: string;
  try {
    content = fs.readFileSync(filePath, "utf-8");
  } catch (error) {
    logger.warn(`[CommandsLoader] Failed to read ${filePath}: ${error}`);
    return null;
  }

  const dirName = path.basename(path.dirname(filePath));
  const parsed = parseFrontmatter(content);

  // No frontmatter — fall back to the containing directory name.
  if (!parsed) {
    return {
      name: dirName,
      description: `Run the ${dirName} command`,
      content: content.trim(),
      scope,
      location: filePath,
    };
  }

  const { metadata, body } = parsed;
  const name = metadata.name || dirName;

  return {
    name,
    description: metadata.description || `Run the ${name} command`,
    argHint: metadata.argHint,
    content: body,
    scope,
    location: filePath,
  };
}

// ============================================================================
// Path Builders
// ============================================================================

/** Glob pattern for <base>/<name>/command.md */
function commandGlob(base: string): string {
  return path.join(base, "*", COMMAND_FILENAME);
}

// ============================================================================
// Main Loader
// ============================================================================

export interface LoaderOptions {
  projectPath: string;
  homeDir?: string;
}

/**
 * Load all user-defined commands from project and user directories.
 * Search order (first found wins):
 *   1. Project: {projectPath}/.freecode/commands/
 *   2. User: ~/.freecode/commands/
 *
 * Returns commands in precedence order (project first, then user).
 */
export async function loadCommands(opts: LoaderOptions): Promise<UserCommand[]> {
  const home = opts.homeDir || os.homedir();
  const commands: UserCommand[] = [];

  // Project-scoped commands (higher precedence)
  const projectCommandsDir = path.join(opts.projectPath, ".freecode", "commands");
  if (fs.existsSync(projectCommandsDir)) {
    const projectPatterns = [commandGlob(projectCommandsDir)];
    const projectMatches = await fg(projectPatterns, {
      absolute: true,
      onlyFiles: true,
      suppressErrors: true,
    });
    for (const filePath of projectMatches) {
      const cmd = parseCommandFile(filePath, "project");
      if (cmd) commands.push(cmd);
    }
  }

  // User-scoped commands (lower precedence)
  const userCommandsDir = path.join(home, ".freecode", "commands");
  if (fs.existsSync(userCommandsDir)) {
    const userPatterns = [commandGlob(userCommandsDir)];
    const userMatches = await fg(userPatterns, {
      absolute: true,
      onlyFiles: true,
      suppressErrors: true,
    });
    for (const filePath of userMatches) {
      const cmd = parseCommandFile(filePath, "user");
      if (cmd) commands.push(cmd);
    }
  }

  return commands;
}

/**
 * Resolve a user command to its prompt string.
 * Supports {{args}}, {{cwd}}, {{arg1}}, {{arg2}}, etc.
 */
export function resolveUserCommand(
  cmd: UserCommand,
  ctx: CommandResolveContext,
): string {
  let prompt = cmd.content;

  // Replace {{args}} with the provided args (joined as string)
  prompt = prompt.replace(/\{\{args\}\}/g, ctx.args.join(" "));

  // Replace {{cwd}} with the current working directory
  prompt = prompt.replace(/\{\{cwd\}\}/g, ctx.cwd);

  // Replace {{arg1}}, {{arg2}}, etc. with individual args
  ctx.args.forEach((arg, index) => {
    prompt = prompt.replace(new RegExp(`\\{\\{arg${index + 1}\\}\\}`, "g"), arg);
  });

  return prompt;
}
