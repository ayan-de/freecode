// =============================================================================
// Skills Injection - Render skills into prompt context
// PRIMARY: Format skill content for inclusion in LLM prompts
// =============================================================================

import type { Skill, SkillMetadata, InjectionOptions } from "./types"

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_HEADER_FORMAT = "--- SKILL: {name} ---"
const DEFAULT_FOOTER_FORMAT = "--- END SKILL ---"
const TRUNCATION_SUFFIX = "\n\n[... skill truncated ...]"

// ============================================================================
// Main Rendering Functions
// ============================================================================

/**
 * Render a single skill for inclusion in a prompt.
 * Format:
 * --- SKILL: commit ---
 * Description: Generate a well-structured git commit message
 *
 * [skill content]
 * --- END SKILL ---
 */
export function renderSkillForPrompt(
  skill: Skill,
  opts: InjectionOptions = {}
): string {
  const {
    includeMetadata = true,
    maxLength = 0,
    headerFormat = DEFAULT_HEADER_FORMAT,
    footerFormat = DEFAULT_FOOTER_FORMAT,
  } = opts

  const parts: string[] = []

  // Header
  const header = headerFormat.replace("{name}", skill.name)
  parts.push(header)

  // Metadata (optional)
  if (includeMetadata) {
    const metadataLines: string[] = []
    metadataLines.push(`Description: ${skill.description || "(no description)"}`)
    if (skill.scope) metadataLines.push(`Scope: ${skill.scope}`)
    if (skill.version) metadataLines.push(`Version: ${skill.version}`)
    parts.push(`[${metadataLines.join(" | ")}]`)
    parts.push("") // blank line after metadata
  }

  // Content
  let content = skill.content

  // Truncate if needed
  if (maxLength > 0 && content.length > maxLength) {
    content = content.slice(0, maxLength - TRUNCATION_SUFFIX.length) + TRUNCATION_SUFFIX
  }

  parts.push(content)

  // Footer
  parts.push("")
  parts.push(footerFormat)

  return parts.join("\n")
}

/**
 * Render multiple skills for inclusion in a prompt.
 * Adds a separator between skills.
 */
export function renderSkillsForPrompt(
  skills: Skill[],
  opts: InjectionOptions = {}
): string {
  if (skills.length === 0) return ""

  const rendered = skills.map((skill) => renderSkillForPrompt(skill, opts))
  return rendered.join("\n\n---\n\n")
}

// ============================================================================
// Metadata-Only Rendering
// ============================================================================

/**
 * Render skill metadata only (for listings, not prompts).
 */
export function renderSkillMetadata(skill: SkillMetadata): string {
  const lines: string[] = []
  lines.push(`**${skill.name}**`)
  if (skill.description) {
    lines.push(`  ${skill.description}`)
  }
  if (skill.scope) {
    lines.push(`  [${skill.scope}]`)
  }
  return lines.join("\n")
}

/**
 * Render multiple skill metadata for display.
 */
export function renderSkillsList(skills: SkillMetadata[]): string {
  if (skills.length === 0) {
    return "No skills available."
  }

  const lines = ["Available skills:", ""]
  for (const skill of skills) {
    lines.push(renderSkillMetadata(skill))
  }
  return lines.join("\n")
}

// ============================================================================
// Compact Rendering (for tool results)
// ============================================================================

/**
 * Render skill in compact format for tool output.
 * Uses XML-like tags similar to existing tool output style.
 */
export function renderSkillCompact(skill: Skill): string {
  const lines: string[] = []
  lines.push(`<skill name="${skill.name}">`)

  if (skill.description) {
    lines.push(`  <description>${skill.description}</description>`)
  }
  if (skill.scope) {
    lines.push(`  <scope>${skill.scope}</scope>`)
  }
  if (skill.location) {
    lines.push(`  <location>${skill.location}</location>`)
  }

  lines.push("  <content>")
  lines.push(...skill.content.split("\n").map((l) => `    ${l}`))
  lines.push("  </content>")
  lines.push("</skill>")

  return lines.join("\n")
}

// ============================================================================
// Skill Selection (for implicit detection - future)
// ============================================================================

/**
 * Score a skill by relevance to a query.
 * Used for ranking when multiple skills might match.
 *
 * Currently not implemented - returns 1.0 for all skills.
 * Future: implement fuzzy matching on name, description, trigger.
 */
export function scoreSkill(skill: Skill, _query: string): number {
  // TODO: Implement relevance scoring
  // - Exact name match: 1.0
  // - Partial name match: 0.7-0.9
  // - Description match: 0.4-0.6
  // - Trigger regex match: 0.8-1.0
  return 1.0
}

/**
 * Filter and rank skills by relevance to a query.
 * Returns skills sorted by score descending.
 *
 * Currently not implemented.
 */
export function rankSkills(skills: Skill[], query: string): Skill[] {
  // TODO: Implement ranking
  // For now, return as-is
  return skills
}

// ============================================================================
// Utilities
// ============================================================================

/**
 * Check if skill content exceeds max length.
 */
export function needsTruncation(skill: Skill, maxLength: number): boolean {
  return skill.content.length > maxLength
}

/**
 * Get the effective max length accounting for metadata.
 */
export function effectiveMaxContentLength(
  skill: Skill,
  opts: InjectionOptions
): number {
  if (!opts.maxLength || opts.maxLength === 0) return 0

  // Subtract metadata overhead
  let overhead = 0
  overhead += DEFAULT_HEADER_FORMAT.replace("{name}", skill.name).length
  overhead += DEFAULT_FOOTER_FORMAT.length
  overhead += 2 // blank lines

  if (opts.includeMetadata) {
    overhead += 50 // approximate metadata size
  }

  return Math.max(0, opts.maxLength - overhead)
}
