// =============================================================================
// skill Tool - Load and invoke specialized skills
// PRIMARY: Allow AI to load skill instructions from .skill.md files
// INPUT: { name: string }
// OUTPUT: Skill content with available files
// NOTE: Uses the skills/ manager system for loading, caching, and rendering
// =============================================================================

import * as fs from "fs"
import * as path from "path"
import fg from "fast-glob"
import type { ToolDef, ToolContext, ToolResult } from "./types"
import type { SkillsManager } from "../skills/manager"
import { renderSkillForPrompt, renderSkillsList } from "../skills/index"

// Module-level skills manager (initialized lazily)
let skillsManager: SkillsManager | null = null

/**
 * Get or create the skills manager for this tool context.
 * Uses project path from context.
 */
function getSkillsManager(ctx: ToolContext): SkillsManager {
  if (!skillsManager) {
    // Lazy import to avoid circular dependencies
    const { SkillsManager } = require("../skills/manager")
    skillsManager = new SkillsManager(ctx.cwd)
  }
  return skillsManager as SkillsManager
}

// Re-export for external use
export { getSkillsManager }

// List files in skill directory (sampled)
function listSkillFiles(skillDir: string, limit: number = 10): string {
  if (!fs.existsSync(skillDir)) return ""

  try {
    const files = fg.sync("**/*", {
      cwd: skillDir,
      onlyFiles: true,
      ignore: ["**/*.skill.md", "**/SKILL.md"],
    })

    const sampled = files.slice(0, limit)
    const more = files.length > limit ? `\n(+ ${files.length - limit} more files)` : ""

    return sampled.map((f) => `<file>${path.resolve(skillDir, f)}</file>`).join("\n") + more
  } catch {
    return ""
  }
}

// List all available skills
async function listSkills(ctx: ToolContext): Promise<string> {
  const manager = getSkillsManager(ctx)
  const skills = await manager.listSkills()

  if (skills.length === 0) {
    return "No skills are currently available."
  }

  // Format as XML-like structure
  const lines = ["<available_skills>"]
  for (const skill of skills.sort((a, b) => a.name.localeCompare(b.name))) {
    lines.push("  <skill>")
    lines.push(`    <name>${skill.name}</name>`)
    if (skill.description) {
      lines.push(`    <description>${skill.description}</description>`)
    }
    lines.push(`    <scope>${skill.scope}</scope>`)
    lines.push("  </skill>")
  }
  lines.push("</available_skills>")

  return lines.join("\n")
}

export interface SkillParams {
  name: string
}

export const SkillTool: ToolDef<SkillParams> = {
  id: "skill",
  description:
    "Load a specialized skill by name. Use when the task matches a known skill workflow. Skills provide structured guidance for specific tasks like brainstorming, TDD, debugging, etc.",
  parameters: {
    type: "object",
    properties: {
      name: { description: "The name of the skill to load" },
    },
    required: ["name"],
  },
  execute: async (params: SkillParams, ctx: ToolContext): Promise<ToolResult> => {
    const manager = getSkillsManager(ctx)

    // Try to get the skill
    const skill = await manager.getSkill(params.name)

    if (!skill) {
      const available = await listSkills(ctx)
      return {
        title: `Skill not found: ${params.name}`,
        output: `Skill "${params.name}" not found.\n\n${available}`,
        metadata: {
          available: (await manager.listSkills()).map((s) => s.name),
        },
      }
    }

    // Get skill directory for file listing
    const skillDir = path.dirname(skill.location)
    const baseUrl = `file://${skillDir}`
    const files = listSkillFiles(skillDir)

    // Render skill content for prompt
    const skillContent = renderSkillForPrompt(skill)

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
    ].join("\n")

    return {
      title: `Loaded skill: ${skill.name}`,
      output,
      metadata: {
        name: skill.name,
        scope: skill.scope,
        dir: skillDir,
      },
    }
  },
}

// Export for listing all available skills
export { listSkills }
