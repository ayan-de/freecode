// =============================================================================
// Skills Injection - Render skills into prompt context
// PRIMARY: Format skill content for inclusion in LLM prompts
// =============================================================================

import type { Skill, SkillMetadata, InjectionOptions } from "./types.js";

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_HEADER_FORMAT = "--- SKILL: {name} ---";
const DEFAULT_FOOTER_FORMAT = "--- END SKILL ---";
const TRUNCATION_SUFFIX = "\n\n[... skill truncated ...]";

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
  opts: InjectionOptions = {},
): string {
  const {
    includeMetadata = true,
    maxLength = 0,
    headerFormat = DEFAULT_HEADER_FORMAT,
    footerFormat = DEFAULT_FOOTER_FORMAT,
  } = opts;

  const parts: string[] = [];

  // Header
  const header = headerFormat.replace("{name}", skill.name);
  parts.push(header);

  // Metadata (optional)
  if (includeMetadata) {
    const metadataLines: string[] = [];
    metadataLines.push(
      `Description: ${skill.description || "(no description)"}`,
    );
    if (skill.scope) metadataLines.push(`Scope: ${skill.scope}`);
    if (skill.version) metadataLines.push(`Version: ${skill.version}`);
    parts.push(`[${metadataLines.join(" | ")}]`);
    parts.push(""); // blank line after metadata
  }

  // Content
  let content = skill.content;

  // Truncate if needed
  if (maxLength > 0 && content.length > maxLength) {
    content =
      content.slice(0, maxLength - TRUNCATION_SUFFIX.length) +
      TRUNCATION_SUFFIX;
  }

  parts.push(content);

  // Footer
  parts.push("");
  parts.push(footerFormat);

  return parts.join("\n");
}

/**
 * Render multiple skills for inclusion in a prompt.
 * Adds a separator between skills.
 */
export function renderSkillsForPrompt(
  skills: Skill[],
  opts: InjectionOptions = {},
): string {
  if (skills.length === 0) return "";

  const rendered = skills.map((skill) => renderSkillForPrompt(skill, opts));
  return rendered.join("\n\n---\n\n");
}

// ============================================================================
// Metadata-Only Rendering
// ============================================================================

/**
 * Render skill metadata only (for listings, not prompts).
 */
export function renderSkillMetadata(skill: SkillMetadata): string {
  const lines: string[] = [];
  lines.push(`**${skill.name}**`);
  if (skill.description) {
    lines.push(`  ${skill.description}`);
  }
  if (skill.scope) {
    lines.push(`  [${skill.scope}]`);
  }
  return lines.join("\n");
}

/**
 * Render multiple skill metadata for display.
 */
export function renderSkillsList(skills: SkillMetadata[]): string {
  if (skills.length === 0) {
    return "No skills available.";
  }

  const lines = ["Available skills:", ""];
  for (const skill of skills) {
    lines.push(renderSkillMetadata(skill));
  }
  return lines.join("\n");
}

// ============================================================================
// Compact Rendering (for tool results)
// ============================================================================

/**
 * Render skill in compact format for tool output.
 * Uses XML-like tags similar to existing tool output style.
 */
export function renderSkillCompact(skill: Skill): string {
  const lines: string[] = [];
  lines.push(`<skill name="${skill.name}">`);

  if (skill.description) {
    lines.push(`  <description>${skill.description}</description>`);
  }
  if (skill.scope) {
    lines.push(`  <scope>${skill.scope}</scope>`);
  }
  if (skill.location) {
    lines.push(`  <location>${skill.location}</location>`);
  }

  lines.push("  <content>");
  lines.push(...skill.content.split("\n").map((l) => `    ${l}`));
  lines.push("  </content>");
  lines.push("</skill>");

  return lines.join("\n");
}

// ============================================================================
// Skill Selection (for implicit detection - future)
// ============================================================================

/**
 * Score a skill by relevance to a query.
 * Used for ranking when multiple skills might match.
 *
 * - Trigger regex match: 1.0
 * - Exact name match: 1.0
 * - Name contains/contained-by query: 0.8
 * - Name shares a word with query: 0.7
 * - Description contains query verbatim: 0.6
 * - Description shares words with query: 0.4-0.6, scaled by hit ratio
 */
export function scoreSkill(skill: SkillMetadata, query: string): number {
  const trimmedQuery = query.trim();
  if (!trimmedQuery) return 0;

  const q = trimmedQuery.toLowerCase();
  const queryWords = q.split(/\s+/).filter((w) => w.length > 2);
  let best = 0;

  if (skill.trigger) {
    try {
      if (new RegExp(skill.trigger, "i").test(trimmedQuery)) {
        best = Math.max(best, 1.0);
      }
    } catch {
      // Invalid regex in skill frontmatter — ignore rather than crash scoring.
    }
  }

  const name = skill.name.toLowerCase();
  if (name === q) {
    best = Math.max(best, 1.0);
  } else if (name.includes(q) || q.includes(name)) {
    best = Math.max(best, 0.8);
  } else if (queryWords.some((word) => name.includes(word))) {
    best = Math.max(best, 0.7);
  }

  if (skill.description) {
    const description = skill.description.toLowerCase();
    if (description.includes(q)) {
      best = Math.max(best, 0.6);
    } else if (queryWords.length > 0) {
      const hits = queryWords.filter((word) => description.includes(word)).length;
      if (hits > 0) {
        best = Math.max(best, 0.4 + 0.2 * (hits / queryWords.length));
      }
    }
  }

  return Math.min(1, best);
}

/**
 * Rank skills by relevance to a query, sorted by score descending.
 * Ties keep their original relative order.
 */
export function rankSkills<T extends SkillMetadata>(
  skills: T[],
  query: string,
): T[] {
  return skills
    .map((skill, index) => ({ skill, index, score: scoreSkill(skill, query) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map(({ skill }) => skill);
}

// ============================================================================
// Utilities
// ============================================================================

/**
 * Check if skill content exceeds max length.
 */
export function needsTruncation(skill: Skill, maxLength: number): boolean {
  return skill.content.length > maxLength;
}

/**
 * Get the effective max length accounting for metadata.
 */
export function effectiveMaxContentLength(
  skill: Skill,
  opts: InjectionOptions,
): number {
  if (!opts.maxLength || opts.maxLength === 0) return 0;

  // Subtract metadata overhead
  let overhead = 0;
  overhead += DEFAULT_HEADER_FORMAT.replace("{name}", skill.name).length;
  overhead += DEFAULT_FOOTER_FORMAT.length;
  overhead += 2; // blank lines

  if (opts.includeMetadata) {
    overhead += 50; // approximate metadata size
  }

  return Math.max(0, opts.maxLength - overhead);
}
