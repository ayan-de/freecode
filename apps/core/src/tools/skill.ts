// =============================================================================
// Skill Tool - Load and invoke specialized skills with UI rendering
// =============================================================================

import * as fs from "fs";
import * as path from "path";
import fg from "fast-glob";
import type { ToolContext } from "./types.js";
import type { Tool, ToolExecutionResult, JsonSchema } from "./tool.types.js";
import { buildTool } from "./factory.js";
import type { SkillsManager } from "../skills/manager.js";
import { getSkillsManagerForProject } from "../skills/manager.js";
import {
  renderSkillForPrompt,
  rankSkills,
  scoreSkill,
} from "../skills/index.js";
import { createRecorder } from "../rollout/recorder.js";

interface SkillParams {
  name: string;
}

// Resolve skills against the session's cwd so two sessions in different repos
// never see each other's project-local skills. The manager cache is shared
// (see getSkillsManagerForProject), not duplicated per call site.
function getSkillsManager(ctx: ToolContext): SkillsManager {
  return getSkillsManagerForProject(ctx.cwd);
}

// =============================================================================
// Skill Schema
// =============================================================================

const skillSchema: JsonSchema = {
  type: "object",
  properties: {
    name: { type: "string", description: "The name of the skill to load" },
  },
  required: ["name"],
};

// =============================================================================
// Input validation
// =============================================================================

function validateSkillInput(
  params: unknown,
): { valid: true } | { valid: false; error: string } {
  if (!params || typeof params !== "object") {
    return { valid: false, error: "Expected object parameters" };
  }
  const p = params as Record<string, unknown>;
  if (typeof p.name !== "string" || p.name.length === 0) {
    return { valid: false, error: "name is required" };
  }
  return { valid: true };
}

// =============================================================================
// List skill files
// =============================================================================

function listSkillFiles(skillDir: string, limit: number = 10): string {
  if (!fs.existsSync(skillDir)) return "";

  try {
    const files = fg.sync("**/*", {
      cwd: skillDir,
      onlyFiles: true,
      ignore: ["**/*.skill.md", "**/SKILL.md"],
    });

    const sampled = files.slice(0, limit);
    const more =
      files.length > limit ? `\n(+ ${files.length - limit} more files)` : "";

    return (
      sampled
        .map((f) => `<file>${path.resolve(skillDir, f)}</file>`)
        .join("\n") + more
    );
  } catch {
    return "";
  }
}

// =============================================================================
// List all available skills
// =============================================================================

async function listSkills(ctx: ToolContext): Promise<string> {
  const manager = getSkillsManager(ctx);
  const skills = await manager.listSkills();

  if (skills.length === 0) {
    return "No skills are currently available.";
  }

  const lines = ["<available_skills>"];
  for (const skill of skills.sort((a, b) => a.name.localeCompare(b.name))) {
    lines.push("  <skill>");
    lines.push(`    <name>${skill.name}</name>`);
    if (skill.description) {
      lines.push(`    <description>${skill.description}</description>`);
    }
    lines.push(`    <scope>${skill.scope}</scope>`);
    lines.push("  </skill>");
  }
  lines.push("</available_skills>");

  return lines.join("\n");
}

// =============================================================================
// Execute function
// =============================================================================

async function executeSkill(
  params: SkillParams,
  ctx: ToolContext,
): Promise<
  ToolExecutionResult<{
    title: string;
    output: string;
    metadata?: Record<string, unknown>;
  }>
> {
  try {
    const manager = getSkillsManager(ctx);

    const skill = await manager.getSkill(params.name);

    if (!skill) {
      const allMetadata = await manager.listSkills();
      const suggestions = rankSkills(allMetadata, params.name)
        .filter((s) => scoreSkill(s, params.name) > 0)
        .slice(0, 3);
      const didYouMean = suggestions.length
        ? `Did you mean: ${suggestions.map((s) => s.name).join(", ")}?\n\n`
        : "";
      const available = await listSkills(ctx);
      return {
        success: false,
        error: `Skill "${params.name}" not found.\n\n${didYouMean}${available}`,
      };
    }

    const skillDir = path.dirname(skill.location);
    const baseUrl = `file://${skillDir}`;
    const files = listSkillFiles(skillDir);

    const skillContent = renderSkillForPrompt(skill);

    if (ctx.sessionId) {
      createRecorder(ctx.sessionId).recordSkillInvoked(skill.name, false);
    }

    const output = [
      `<skill_content name="${skill.name}">`,
      skillContent,
      "",
      `Base directory: ${baseUrl}`,
      "Relative paths in this skill are relative to this base directory.",
      "",
      "<skill_files>",
      files || "(no additional files)",
      "</skill_files>",
      "</skill_content>",
    ].join("\n");

    return {
      success: true,
      result: {
        title: `Loaded skill: ${skill.name}`,
        output,
        metadata: {
          name: skill.name,
          scope: skill.scope,
          dir: skillDir,
        },
      },
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

// =============================================================================
// SkillTool - Built with buildTool() factory
// =============================================================================

export const SkillTool: Tool<SkillParams> = buildTool({
  id: "skill",
  description: `Load a skill by name — a packaged set of instructions for a particular kind of task. When the work matches one of the available skills, load it before falling back to your default approach; the instructions come back as the tool result for you to follow.`,
  schemas: {
    parameters: skillSchema,
  },
  permissions: {
    operations: ["file.read"],
  },
  behavior: {
    isConcurrencySafe: true,
    isDestructive: false,
    userFacingName: "Skill",
  },
  execute: executeSkill,
  validateInput: validateSkillInput,
  isSearchOrReadCommand: () => ({ isSearch: false, isRead: false }),
});
