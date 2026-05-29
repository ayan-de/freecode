// =============================================================================
// Skills Manager - Main service for skills system
// PRIMARY: Coordinates loader, registry, and caching
// USAGE:
//   const manager = new SkillsManager("/path/to/project")
//   await manager.initialize()
//   const skill = await manager.getSkill("commit")
// =============================================================================

import type {
  Skill,
  SkillMetadata,
  SkillScope,
  ManagerOptions,
  SkillsInitializationResult,
} from "./types"
import { loadAllSkills, loadSkill } from "./loader"
import { SkillRegistry, createSkillRegistry } from "./registry"

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes

// ============================================================================
// SkillsManager Class
// ============================================================================

export class SkillsManager {
  private projectPath: string
  private installDir: string
  private registry: SkillRegistry
  private caching: boolean
  private cacheTtlMs: number
  private lastLoadTime: number = 0
  private initialized: boolean = false
  private initializing: boolean = false

  constructor(projectPath: string, installDir?: string)
  constructor(opts: ManagerOptions)
  constructor(projectPathOrOpts: string | ManagerOptions, installDir?: string) {
    if (typeof projectPathOrOpts === "string") {
      this.projectPath = projectPathOrOpts
      this.installDir = installDir || ""
      this.caching = true
      this.cacheTtlMs = DEFAULT_CACHE_TTL_MS
    } else {
      this.projectPath = projectPathOrOpts.projectPath
      this.installDir = projectPathOrOpts.installDir || ""
      this.caching = projectPathOrOpts.caching ?? true
      this.cacheTtlMs = projectPathOrOpts.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS
    }

    this.registry = createSkillRegistry()
  }

  // ===========================================================================
  // Initialization
  // ===========================================================================

  /**
   * Initialize the manager - load all skills from disk and cache them.
   * Call this once at startup before using other methods.
   */
  async initialize(): Promise<SkillsInitializationResult> {
    if (this.initializing) {
      // Wait for ongoing initialization
      return this.waitForInitialization()
    }

    if (this.initialized && this.caching && !this.isCacheStale()) {
      return {
        success: true,
        skillCount: this.registry.size(),
        errors: [],
      }
    }

    this.initializing = true

    try {
      console.log("[SkillsManager] Loading skills...")

      const result = await loadAllSkills({
        projectPath: this.projectPath,
        installDir: this.installDir,
      })

      // Register all loaded skills
      this.registry.registerMany(result.skills)

      this.lastLoadTime = Date.now()
      this.initialized = true

      const summary = this.getSummary()
      console.log(
        `[SkillsManager] Loaded ${result.skills.length} skills ` +
          `(${summary.repo} repo, ${summary.user} user, ${summary.system} system)`
      )

      return {
        success: true,
        skillCount: result.skills.length,
        errors: result.errors.map((e) => e.error),
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error)
      console.error(`[SkillsManager] Initialization failed: ${errorMsg}`)
      return {
        success: false,
        skillCount: 0,
        errors: [errorMsg],
      }
    } finally {
      this.initializing = false
    }
  }

  private async waitForInitialization(): Promise<SkillsInitializationResult> {
    // Simple polling - in production this could use a promise chain
    let attempts = 0
    while (this.initializing && attempts < 100) {
      await new Promise((resolve) => setTimeout(resolve, 50))
      attempts++
    }

    if (!this.initialized) {
      return {
        success: false,
        skillCount: 0,
        errors: ["Initialization timed out"],
      }
    }

    return {
      success: true,
      skillCount: this.registry.size(),
      errors: [],
    }
  }

  private isCacheStale(): boolean {
    return Date.now() - this.lastLoadTime > this.cacheTtlMs
  }

  // ===========================================================================
  // Retrieval
  // ===========================================================================

  /**
   * Get a skill by name.
   * Searches scopes in priority order: repo, user, system, admin.
   */
  async getSkill(name: string): Promise<Skill | null> {
    await this.ensureInitialized()

    // Check registry first (cache hit)
    const cached = this.registry.findByName(name)
    if (cached) return cached

    // Try to load from disk (cache miss for dynamically added skills)
    const scopeOrder: SkillScope[] = ["repo", "user", "system", "admin"]

    for (const scope of scopeOrder) {
      const skill = await loadSkill(name, scope, this.projectPath)
      if (skill) {
        this.registry.register(skill)
        return skill
      }
    }

    return null
  }

  /**
   * Get a skill by name and explicit scope.
   */
  async getSkillByScope(name: string, scope: SkillScope): Promise<Skill | null> {
    await this.ensureInitialized()

    // Check registry first
    const cached = this.registry.getByNameAndScope(name, scope)
    if (cached) return cached

    // Try to load from disk
    const skill = await loadSkill(name, scope, this.projectPath)
    if (skill) {
      this.registry.register(skill)
    }

    return skill
  }

  /**
   * List all available skills (metadata only, no content).
   */
  async listSkills(): Promise<SkillMetadata[]> {
    await this.ensureInitialized()

    return this.registry.getAll().map((s) => ({
      name: s.name,
      description: s.description,
      scope: s.scope,
      trigger: s.trigger,
      version: s.version,
      parameters: s.parameters,
    }))
  }

  /**
   * List skills of a specific scope.
   */
  async listSkillsByScope(scope: SkillScope): Promise<SkillMetadata[]> {
    await this.ensureInitialized()

    return this.registry.getByScope(scope).map((s) => ({
      name: s.name,
      description: s.description,
      scope: s.scope,
      trigger: s.trigger,
      version: s.version,
      parameters: s.parameters,
    }))
  }

  // ===========================================================================
  // Cache Management
  // ===========================================================================

  /**
   * Check if a skill exists (in cache or on disk).
   */
  async hasSkill(name: string): Promise<boolean> {
    const skill = await this.getSkill(name)
    return skill !== null
  }

  /**
   * Reload all skills from disk, clearing the cache.
   */
  async reload(): Promise<SkillsInitializationResult> {
    this.registry.clear()
    this.lastLoadTime = 0
    this.initialized = false
    return this.initialize()
  }

  /**
   * Invalidate cache without full reload.
   * Next access will re-check disk but won't re-parse unchanged files.
   */
  invalidateCache(): void {
    this.lastLoadTime = 0
  }

  // ===========================================================================
  // Query
  // ===========================================================================

  /**
   * Get total number of loaded skills.
   */
  count(): number {
    return this.registry.size()
  }

  /**
   * Get count by scope.
   */
  countByScope(scope: SkillScope): number {
    return this.registry.countByScope(scope)
  }

  /**
   * Get summary of loaded skills.
   */
  getSummary(): { repo: number; user: number; system: number; admin: number; total: number } {
    return {
      repo: this.registry.countByScope("repo"),
      user: this.registry.countByScope("user"),
      system: this.registry.countByScope("system"),
      admin: this.registry.countByScope("admin"),
      total: this.registry.size(),
    }
  }

  // ===========================================================================
  // Private Helpers
  // ===========================================================================

  private async ensureInitialized(): Promise<void> {
    if (!this.initialized && !this.initializing) {
      await this.initialize()
    }
  }
}

// ============================================================================
// Factory
// ============================================================================

export function createSkillsManager(projectPath: string, installDir?: string): SkillsManager {
  return new SkillsManager(projectPath, installDir)
}

// ============================================================================
// Singleton instance (optional - for simpler use cases)
// ============================================================================

let globalManager: SkillsManager | null = null

export function getGlobalSkillsManager(): SkillsManager | null {
  return globalManager
}

export function setGlobalSkillsManager(manager: SkillsManager): void {
  globalManager = manager
}

export async function getOrCreateGlobalSkillsManager(
  projectPath: string,
  installDir?: string
): Promise<SkillsManager> {
  if (!globalManager) {
    globalManager = createSkillsManager(projectPath, installDir)
    await globalManager.initialize()
  }
  return globalManager
}
