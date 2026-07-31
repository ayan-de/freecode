// =============================================================================
// Skills Loader - Discovers and parses directory-based SKILL.md files
// PRIMARY: Find <name>/SKILL.md on disk, extract frontmatter, return Skill objects
// FORMAT: Claude Code / Anthropic compatible — <skills-dir>/<name>/SKILL.md
// SEARCH PATHS (highest precedence last within a scope):
//   system: {installDir}/.system/skills/*/SKILL.md
//   plugin: ~/.claude/plugins/**/skills/*/SKILL.md (installed Claude Code plugins)
//   user:   ~/.claude/skills, ~/.agents/skills, ~/.freecode/skills  (global)
//   repo:   {projectPath}/{.claude,.agents,.freecode}/skills          (project)
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
import { logger } from "../utils/logger.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============================================================================
// Constants
// ============================================================================

const SKILL_FILENAME = "SKILL.md";
const FRONTMATTER_REGEX = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/;
// Bound how deep we walk under a plugin root when hunting for skills/ dirs.
// Plugin layouts vary (cache/<mkt>/<plugin>/<ver>/skills, repos/<owner>/<repo>/skills,
// nested .claude/skills), so scan defensively but with a limit.
const PLUGIN_SCAN_DEPTH = 6;

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
// Path Builders
// ============================================================================

/** Glob pattern for the standard one-level layout: <base>/<name>/SKILL.md */
function skillGlob(base: string): string {
  return path.join(base, "*", SKILL_FILENAME);
}

interface SearchGroup {
  patterns: string[];
  scope: SkillScope;
  /** Max `**` depth (plugins only); undefined for the flat one-level layouts */
  deep?: number;
  /** Extra ignore globs (e.g. exclude localized doc mirrors under plugins) */
  ignore?: string[];
}

function getSearchGroups(opts: LoaderOptions): SearchGroup[] {
  const home = opts.homeDir || os.homedir();
  const installDir = opts.installDir || path.join(__dirname, "..", "..", "..");
  const plugin = getPluginSkillPatterns(home);

  return [
    {
      scope: "system",
      patterns: [skillGlob(path.join(installDir, ".system", "skills"))],
    },
    {
      scope: "plugin",
      patterns: plugin.patterns,
      deep: plugin.deep,
      ignore: plugin.ignore,
    },
    {
      // Load external tools first, FreeCode's own dir last so it wins on ties.
      scope: "user",
      patterns: [
        skillGlob(path.join(home, ".claude", "skills")),
        skillGlob(path.join(home, ".agents", "skills")),
        skillGlob(path.join(home, ".freecode", "skills")),
      ],
    },
    {
      scope: "repo",
      patterns: [
        skillGlob(path.join(opts.projectPath, ".claude", "skills")),
        skillGlob(path.join(opts.projectPath, ".agents", "skills")),
        skillGlob(path.join(opts.projectPath, ".freecode", "skills")),
      ],
    },
  ];
}

/**
 * Discover skill globs provided by installed Claude Code plugins under
 * ~/.claude/plugins. When installed_plugins.json is present it is the source
 * of truth: each plugin exposes skills at <installPath>/skills (and the nested
 * .claude/.agents variants), scanned one level deep — this avoids sweeping up
 * localized documentation mirrors (docs/<locale>/skills). Only when the
 * manifest is missing do we fall back to a bounded deep scan of cache/ and
 * repos/, excluding docs mirrors.
 */
function getPluginSkillPatterns(home: string): {
  patterns: string[];
  deep?: number;
  ignore?: string[];
} {
  const pluginsRoot = path.join(home, ".claude", "plugins");
  if (!fs.existsSync(pluginsRoot)) return { patterns: [] };

  const installPaths = readInstalledPluginPaths(
    path.join(pluginsRoot, "installed_plugins.json"),
  );

  if (installPaths.length > 0) {
    const patterns = installPaths.flatMap((p) => [
      skillGlob(path.join(p, "skills")),
      skillGlob(path.join(p, ".claude", "skills")),
      skillGlob(path.join(p, ".agents", "skills")),
    ]);
    return { patterns };
  }

  const roots = [
    path.join(pluginsRoot, "cache"),
    path.join(pluginsRoot, "repos"),
  ].filter((p) => fs.existsSync(p));

  return {
    patterns: roots.map((root) =>
      path.join(root, "**", "skills", "*", SKILL_FILENAME),
    ),
    deep: PLUGIN_SCAN_DEPTH,
    ignore: ["**/docs/**"],
  };
}

/** Parse install paths from a Claude Code installed_plugins.json manifest. */
function readInstalledPluginPaths(manifest: string): string[] {
  let raw: string;
  try {
    raw = fs.readFileSync(manifest, "utf-8");
  } catch {
    return [];
  }
  try {
    const value = JSON.parse(raw) as {
      plugins?: Record<string, unknown>;
    };
    const plugins = value.plugins;
    if (!plugins || typeof plugins !== "object") return [];

    const paths: string[] = [];
    for (const installs of Object.values(plugins)) {
      const list = Array.isArray(installs) ? installs : [installs];
      for (const install of list) {
        const p = (install as { installPath?: unknown })?.installPath;
        if (typeof p === "string" && fs.existsSync(p)) paths.push(p);
      }
    }
    return paths;
  } catch {
    return [];
  }
}

// ============================================================================
// Skill File Parser
// ============================================================================

function parseSkillFile(filePath: string, scope: SkillScope): Skill | null {
  let content: string;
  try {
    content = fs.readFileSync(filePath, "utf-8");
  } catch (error) {
    logger.warn(`[SkillsLoader] Failed to read ${filePath}: ${error}`);
    return null;
  }

  const dirName = path.basename(path.dirname(filePath));
  const parsed = parseFrontmatter(content);

  // No frontmatter — fall back to the containing directory name.
  if (!parsed) {
    return {
      name: dirName,
      scope,
      content: content.trim(),
      location: filePath,
      id: `${scope}/${dirName}`,
      loadedAt: Date.now(),
    };
  }

  const { metadata, body } = parsed;
  const name = metadata.name || dirName;

  let trigger: string | undefined = metadata.trigger;
  if (trigger) {
    try {
      new RegExp(trigger);
    } catch {
      logger.warn(`[SkillsLoader] Invalid trigger regex in ${filePath}`);
      trigger = undefined;
    }
  }

  const allowedToolsRaw = metadata["allowed-tools"];
  const allowedTools = allowedToolsRaw
    ? allowedToolsRaw
        .split(",")
        .map((t) => t.trim())
        .filter((t) => t.length > 0)
    : undefined;

  return {
    name,
    description: metadata.description,
    scope,
    allowedTools,
    trigger,
    version: metadata.version,
    content: body,
    location: filePath,
    id: `${scope}/${name}`,
    loadedAt: Date.now(),
  };
}

// ============================================================================
// Main Loader Functions
// ============================================================================

async function globSkillFiles(
  patterns: string[],
  deep?: number,
  ignore: string[] = [],
): Promise<string[]> {
  if (patterns.length === 0) return [];
  return fg.glob(patterns, {
    absolute: true,
    onlyFiles: true,
    deep,
    ignore: ["**/node_modules/**", "**/.git/**", ...ignore],
    suppressErrors: true,
  });
}

/**
 * Load all skills from all search paths.
 * Non-fatal — returns errors but still returns successfully parsed skills.
 */
export async function loadAllSkills(
  opts: LoaderOptions,
): Promise<SkillLoadResult> {
  const groups = getSearchGroups(opts);
  const skills: Skill[] = [];
  const errors: Array<{ path: string; error: string }> = [];

  for (const { patterns, scope, deep, ignore } of groups) {
    let matches: string[] = [];
    try {
      matches = await globSkillFiles(patterns, deep, ignore);
    } catch (error) {
      console.debug(`[SkillsLoader] Glob failed for ${scope}: ${error}`);
      continue;
    }

    // Sorted so that, within a scope, the last pattern's dir wins on name ties.
    for (const filePath of matches.sort()) {
      const skill = parseSkillFile(filePath, scope);
      if (skill) skills.push(skill);
      else errors.push({ path: filePath, error: "Failed to parse skill" });
    }
  }

  return { skills, errors };
}

/**
 * Load a specific skill by name and scope. Scans the scope's skill dirs and
 * matches on frontmatter name (or directory name for skills without it).
 */
export async function loadSkill(
  name: string,
  scope: SkillScope,
  projectPath: string,
): Promise<Skill | null> {
  const group = getSearchGroups({ projectPath }).find((g) => g.scope === scope);
  if (!group) return null;

  const matches = await globSkillFiles(group.patterns, group.deep, group.ignore);
  for (const filePath of matches.sort()) {
    const skill = parseSkillFile(filePath, scope);
    if (skill && skill.name === name) return skill;
  }
  return null;
}

/**
 * Check if a skill file exists without keeping its content.
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
