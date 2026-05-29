// =============================================================================
// Skills Types - Core interfaces for the skills system
// PRIMARY: Type definitions for Skill, SkillMetadata, SkillScope, SkillMatch
// PURPOSE: Define contracts for loader, registry, manager, and injection
// =============================================================================

// ============================================================================
// Scope - Where skills are stored and who can access them
// ============================================================================

export type SkillScope = "user" | "repo" | "system" | "admin"

// ============================================================================
// Skill Metadata - Frontmatter parsed from .skill.md files
// ============================================================================

export interface SkillMetadata {
  /** Skill name - must be unique within a scope */
  name: string
  /** Human-readable description of what the skill does */
  description?: string
  /** Scope determines where the skill is stored and who can access it */
  scope: SkillScope
  /** Regex pattern for future implicit detection (optional) */
  trigger?: string
  /** Semantic version for future compatibility */
  version?: string
  /** Optional expected parameters for the skill */
  parameters?: Record<string, unknown>
}

// ============================================================================
// Skill - Full skill object with content and location
// ============================================================================

export interface Skill extends SkillMetadata {
  /** Unique identifier: "${scope}/${name}" (e.g., "user/commit") */
  id: string
  /** Raw markdown body content (after frontmatter) */
  content: string
  /** File path where the skill was discovered */
  location: string
  /** Timestamp when skill was loaded (for cache management) */
  loadedAt: number
}

// ============================================================================
// SkillMatch - For future relevance ranking in implicit detection
// ============================================================================

export interface SkillMatch {
  /** The matched skill */
  skill: Skill
  /** Relevance score (0-1) for ranking multiple matches */
  score: number
  /** What triggered the match: name, trigger regex, or description */
  matchedOn: "name" | "trigger" | "description"
}

// ============================================================================
// Loader Types - Configuration for skill discovery
// ============================================================================

export interface LoaderOptions {
  /** Project path for repo-scoped skills */
  projectPath: string
  /** Installation directory for system skills (defaults to app directory) */
  installDir?: string
  /** Force reload even if cached */
  forceReload?: boolean
}

export interface SkillLoadResult {
  /** Successfully loaded skills */
  skills: Skill[]
  /** Errors encountered during loading (non-fatal) */
  errors: Array<{ path: string; error: string }>
}

// ============================================================================
// Registry Types - For in-memory skill storage
// ============================================================================

export interface RegistryOptions {
  /** Allow duplicate skill names across scopes */
  allowDuplicates?: boolean
}

// ============================================================================
// Injection Types - For rendering skills into prompts
// ============================================================================

export interface InjectionOptions {
  /** Include skill name and description in output */
  includeMetadata?: boolean
  /** Truncate skill content if exceeds this length (0 = no limit) */
  maxLength?: number
  /** Custom header format (uses default if not specified) */
  headerFormat?: string
  /** Custom footer format (uses default if not specified) */
  footerFormat?: string
}

// ============================================================================
// Manager Types - For the main skills service
// ============================================================================

export interface ManagerOptions {
  /** Project path for repo-scoped skills */
  projectPath: string
  /** Installation directory for system skills */
  installDir?: string
  /** Enable caching (default: true) */
  caching?: boolean
  /** Cache TTL in milliseconds (default: 5 minutes) */
  cacheTtlMs?: number
}

export interface SkillsInitializationResult {
  /** Whether initialization succeeded */
  success: boolean
  /** Number of skills loaded */
  skillCount: number
  /** Errors encountered (non-fatal) */
  errors: string[]
}
