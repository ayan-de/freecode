// =============================================================================
// skill Tool - Load and invoke specialized skills
// PRIMARY: Allow AI to load skill instructions from SKILL.md files
// INPUT: { name: string }
// OUTPUT: Skill content with available files
// NOTE: Skills are discovered from ~/.claude/skills/ and project .claude/skills/
// =============================================================================

import * as fs from "fs"
import * as path from "path"
import fg from "fast-glob"
import type { ToolDef, ToolContext, ToolResult } from "./types"

export interface SkillParams {
  name: string
}

interface SkillInfo {
  name: string
  description?: string
  location: string
  content: string
}

// Scan for skill files in standard locations
function discoverSkills(cwd: string): SkillInfo[] {
  const skills: SkillInfo[] = []
  const homedir = require("os").homedir()

  const searchPaths = [
    path.join(homedir, ".claude", "skills"),
    path.join(homedir, ".agents", "skills"),
    path.join(cwd, ".claude", "skills"),
    path.join(cwd, ".freecode", "skills"),
  ]

  for (const searchPath of searchPaths) {
    if (!fs.existsSync(searchPath)) continue

    const files = fg.sync("**/SKILL.md", {
      cwd: searchPath,
      onlyFiles: true,
      absolute: true,
    })

    for (const file of files) {
      try {
        const content = fs.readFileSync(file, "utf-8")
        const info = parseSkillMarkdown(content, file)
        if (info) {
          skills.push(info)
        }
      } catch {
        // Skip files that can't be read
      }
    }
  }

  return skills
}

// Parse SKILL.md with optional frontmatter
function parseSkillMarkdown(content: string, location: string): SkillInfo | null {
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/)
  let name: string
  let description: string | undefined
  let body: string

  if (frontmatterMatch) {
    const frontmatter = frontmatterMatch[1]
    const bodyCandidate = frontmatterMatch[2]

    const nameMatch = frontmatter.match(/^name:\s*(.+)$/m)
    const descMatch = frontmatter.match(/^description:\s*(.+)$/m)

    if (!nameMatch) return null
    name = nameMatch[1].trim()
    description = descMatch?.[1].trim()
    body = bodyCandidate.trim()
  } else {
    // No frontmatter - use filename as name
    const basename = path.basename(path.dirname(location))
    name = basename
    body = content.trim()
  }

  return {
    name,
    description,
    location,
    content: body,
  }
}

// List all available skills
function listSkills(skills: SkillInfo[]): string {
  const described = skills.filter((s) => s.description)
  if (described.length === 0) {
    return "No skills are currently available."
  }

  const lines = ["<available_skills>"]
  for (const skill of described.sort((a, b) => a.name.localeCompare(b.name))) {
    lines.push("  <skill>")
    lines.push(`    <name>${skill.name}</name>`)
    if (skill.description) {
      lines.push(`    <description>${skill.description}</description>`)
    }
    lines.push(`    <location>${path.dirname(skill.location)}</location>`)
    lines.push("  </skill>")
  }
  lines.push("</available_skills>")

  return lines.join("\n")
}

// List files in skill directory (sampled)
function listSkillFiles(skillDir: string, limit: number = 10): string {
  if (!fs.existsSync(skillDir)) return ""

  try {
    const files = fg.sync("**/*", {
      cwd: skillDir,
      onlyFiles: true,
      ignore: ["**/SKILL.md"],
    })

    const sampled = files.slice(0, limit)
    const more = files.length > limit ? `\n(+ ${files.length - limit} more files)` : ""

    return sampled.map((f) => `<file>${path.resolve(skillDir, f)}</file>`).join("\n") + more
  } catch {
    return ""
  }
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
    const skills = discoverSkills(ctx.cwd)
    const skill = skills.find((s) => s.name === params.name)

    if (!skill) {
      const available = listSkills(skills)
      return {
        title: `Skill not found: ${params.name}`,
        output: `Skill "${params.name}" not found.\n\n${available}`,
        metadata: {
          available: skills.map((s) => s.name),
        },
      }
    }

    const skillDir = path.dirname(skill.location)
    const baseUrl = `file://${skillDir}`
    const files = listSkillFiles(skillDir)

    const output = [
      `<skill_content name="${skill.name}">`,
      `# Skill: ${skill.name}`,
      "",
      skill.content,
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
        dir: skillDir,
      },
    }
  },
}

// Export for listing all available skills
export { listSkills, discoverSkills }
