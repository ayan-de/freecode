// =============================================================================
// Skills Loader - Discovers and parses .skill.md files from filesystem
// PRIMARY: Find skills on disk, extract frontmatter, return Skill objects
// SEARCH PATHS:
//   - system: {installDir}/.system/skills/**/*.skill.md
//   - user: ~/.freecode/skills/**/*.skill.md
//   - repo: {projectPath}/.freecode/skills/**/*.skill.md
// =============================================================================

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { fileURLToPath } from "url";
import fg from "fast-glob";
import type {
  Skill,
  SkillScope,
  LoaderOptions,
  SkillLoadResult,
} from "./types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============================================================================
// Constants
// ============================================================================

const SKILL_FILENAME = "*.skill.md";
const FRONTMATTER_REGEX = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/;

// ============================================================================
// YAML Frontmatter Parser (simple, no external dependency)
// ============================================================================

function parseFrontmatter(
  content: string,
): { metadata: Record<string, string>; body: string } | null {
  const match = content.match(FRONTMATTER_REGEX);
  if (!match) return null;

  const frontmatterStr = match[1];
  const body = match[2].trim();

  // Simple YAML parsing for flat key-value pairs
  const metadata: Record<string, string> = {};
  const lines = frontmatterStr.split("\n");

  for (const line of lines) {
    const colonIndex = line.indexOf(":");
    if (colonIndex === -1) continue;

    const key = line.slice(0, colonIndex).trim();
    const value = line.slice(colonIndex + 1).trim();

    // Remove quotes if present
    const cleanValue = value.replace(/^["']|["']$/g, "");

    metadata[key] = cleanValue;
  }

  return { metadata, body };
}

// ============================================================================
// Path Builders
// ============================================================================

function getSearchPaths(
  opts: LoaderOptions,
): Array<{ pattern: string; scope: SkillScope }> {
  const homedir = os.homedir();
  const installDir = opts.installDir || path.join(__dirname, "..", "..", "..");

  return [
    // System skills: installed with the application
    {
      pattern: path.join(installDir, ".system", "skills", SKILL_FILENAME),
      scope: "system" as SkillScope,
    },
    // User skills: ~/.freecode/skills/
    {
      pattern: path.join(homedir, ".freecode", "skills", SKILL_FILENAME),
      scope: "user" as SkillScope,
    },
    // Repo skills: {projectPath}/.freecode/skills/
    {
      pattern: path.join(
        opts.projectPath,
        ".freecode",
        "skills",
        SKILL_FILENAME,
      ),
      scope: "repo" as SkillScope,
    },
  ];
}

// ============================================================================
// Skill File Parser
// ============================================================================

function parseSkillFile(filePath: string, scope: SkillScope): Skill | null {
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    const parsed = parseFrontmatter(content);

    if (!parsed) {
      // No frontmatter - use filename-derived name
      const basename = path.basename(path.dirname(filePath));
      return {
        name: basename,
        description: undefined,
        scope,
        content: content.trim(),
        location: filePath,
        id: `${scope}/${basename}`,
        loadedAt: Date.now(),
      };
    }

    const { metadata, body } = parsed;
    const name = metadata.name;

    if (!name) {
      console.warn(`[SkillsLoader] Skipping skill without name: ${filePath}`);
      return null;
    }

    // Parse trigger as regex if present
    let trigger: string | undefined = metadata.trigger;
    if (trigger) {
      // Validate it's a valid regex
      try {
        new RegExp(trigger);
      } catch {
        console.warn(
          `[SkillsLoader] Invalid trigger regex in ${filePath}: ${trigger}`,
        );
        trigger = undefined;
      }
    }

    return {
      name,
      description: metadata.description,
      scope,
      trigger,
      version: metadata.version,
      content: body,
      location: filePath,
      id: `${scope}/${name}`,
      loadedAt: Date.now(),
    };
  } catch (error) {
    console.warn(
      `[SkillsLoader] Failed to read skill file ${filePath}: ${error}`,
    );
    return null;
  }
}

// ============================================================================
// Main Loader Functions
// ============================================================================

/**
 * Load all skills from all search paths.
 * Non-fatal - returns errors but still returns successfully parsed skills.
 */
export async function loadAllSkills(
  opts: LoaderOptions,
): Promise<SkillLoadResult> {
  const searchPaths = getSearchPaths(opts);
  const skills: Skill[] = [];
  const errors: Array<{ path: string; error: string }> = [];

  for (const { pattern, scope } of searchPaths) {
    try {
      // Glob returns array of matching paths
      const matches = await fg.glob([pattern], {
        absolute: true,
        onlyFiles: true,
      });

      for (const filePath of matches) {
        const skill = parseSkillFile(filePath, scope);
        if (skill) {
          skills.push(skill);
        } else {
          errors.push({ path: filePath, error: "Failed to parse skill" });
        }
      }
    } catch (error) {
      // Directory might not exist - that's okay
      console.debug(`[SkillsLoader] No skills found at ${pattern}: ${error}`);
    }
  }

  return { skills, errors };
}

/**
 * Load a specific skill by name and scope.
 * Searches only the path for that specific scope.
 */
export async function loadSkill(
  name: string,
  scope: SkillScope,
  projectPath: string,
): Promise<Skill | null> {
  const homedir = os.homedir();
  const installDir = path.join(__dirname, "..", "..", "..");

  let pattern: string;
  switch (scope) {
    case "system":
      pattern = path.join(
        installDir,
        ".system",
        "skills",
        "**",
        `${name}.skill.md`,
      );
      break;
    case "user":
      pattern = path.join(
        homedir,
        ".freecode",
        "skills",
        "**",
        `${name}.skill.md`,
      );
      break;
    case "repo":
      pattern = path.join(
        projectPath,
        ".freecode",
        "skills",
        "**",
        `${name}.skill.md`,
      );
      break;
    case "admin":
      // Admin skills are system skills with restricted access
      pattern = path.join(
        installDir,
        ".system",
        "skills",
        "**",
        `${name}.skill.md`,
      );
      break;
    default:
      return null;
  }

  try {
    const matches = await fg.glob([pattern], {
      absolute: true,
      onlyFiles: true,
    });

    if (matches.length === 0) return null;
    if (matches.length > 1) {
      console.warn(
        `[SkillsLoader] Multiple skills found for ${scope}/${name}, using first`,
      );
    }

    return parseSkillFile(matches[0], scope);
  } catch (error) {
    console.warn(
      `[SkillsLoader] Failed to load skill ${scope}/${name}: ${error}`,
    );
    return null;
  }
}

/**
 * Check if a skill file exists without loading its content.
 */
export async function skillExists(
  name: string,
  scope: SkillScope,
  projectPath: string,
): Promise<boolean> {
  const skill = await loadSkill(name, scope, projectPath);
  return skill !== null;
}

// ============================================================================
// Re-export types for convenience
// ============================================================================

export type {
  LoaderOptions,
  SkillLoadResult,
  Skill,
  SkillScope,
} from "./types.js";
