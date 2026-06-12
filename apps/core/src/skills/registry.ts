// =============================================================================
// Skills Registry - In-memory storage for discovered skills
// PRIMARY: Store skills by ID, query by scope, check existence
// NOTE: This is a simple in-memory store. For persistence, see thread store.
// =============================================================================

import type { Skill, SkillScope, RegistryOptions } from "./types";

// ============================================================================
// Registry Class
// ============================================================================

export class SkillRegistry {
  private skills: Map<string, Skill> = new Map();
  private scopeIndex: Map<SkillScope, Set<string>> = new Map([
    ["system", new Set()],
    ["user", new Set()],
    ["repo", new Set()],
    ["admin", new Set()],
  ]);
  private readonly allowDuplicates: boolean;

  constructor(opts: RegistryOptions = {}) {
    this.allowDuplicates = opts.allowDuplicates ?? false;
  }

  // ===========================================================================
  // Registration
  // ===========================================================================

  /**
   * Register a skill in the registry.
   * If a skill with the same ID already exists, it will be replaced.
   */
  register(skill: Skill): void {
    const existing = this.skills.get(skill.id);

    if (existing && !this.allowDuplicates) {
      // Replace existing skill
      this.scopeIndex.get(existing.scope)?.delete(existing.id);
    }

    this.skills.set(skill.id, skill);
    this.scopeIndex.get(skill.scope)?.add(skill.id);
  }

  /**
   * Register multiple skills at once.
   */
  registerMany(skills: Skill[]): void {
    for (const skill of skills) {
      this.register(skill);
    }
  }

  // ===========================================================================
  // Retrieval
  // ===========================================================================

  /**
   * Get a skill by its unique ID (e.g., "user/commit").
   */
  get(id: string): Skill | undefined {
    return this.skills.get(id);
  }

  /**
   * Get a skill by name and scope.
   * Convenience method equivalent to get("${scope}/${name}").
   */
  getByNameAndScope(name: string, scope: SkillScope): Skill | undefined {
    return this.skills.get(`${scope}/${name}`);
  }

  /**
   * Get all skills of a specific scope.
   */
  getByScope(scope: SkillScope): Skill[] {
    const ids = this.scopeIndex.get(scope);
    if (!ids) return [];

    const result: Skill[] = [];
    for (const id of ids) {
      const skill = this.skills.get(id);
      if (skill) result.push(skill);
    }
    return result;
  }

  /**
   * Get all registered skills.
   */
  getAll(): Skill[] {
    return Array.from(this.skills.values());
  }

  /**
   * Find skills by name (searches across all scopes).
   * Returns the first match found (order: repo, user, system).
   */
  findByName(name: string): Skill | undefined {
    // Try in priority order: repo, user, system, admin
    const scopeOrder: SkillScope[] = ["repo", "user", "system", "admin"];

    for (const scope of scopeOrder) {
      const skill = this.getByNameAndScope(name, scope);
      if (skill) return skill;
    }

    return undefined;
  }

  /**
   * Find all skills matching a predicate.
   */
  filter(predicate: (skill: Skill) => boolean): Skill[] {
    return this.getAll().filter(predicate);
  }

  // ===========================================================================
  // Query
  // ===========================================================================

  /**
   * Check if a skill exists by ID.
   */
  has(id: string): boolean {
    return this.skills.has(id);
  }

  /**
   * Check if a skill exists by name and scope.
   */
  hasByNameAndScope(name: string, scope: SkillScope): boolean {
    return this.has(`${scope}/${name}`);
  }

  /**
   * Get the total number of registered skills.
   */
  size(): number {
    return this.skills.size;
  }

  /**
   * Get skill count by scope.
   */
  countByScope(scope: SkillScope): number {
    return this.scopeIndex.get(scope)?.size ?? 0;
  }

  // ===========================================================================
  // Mutation
  // ===========================================================================

  /**
   * Remove a skill by ID.
   */
  remove(id: string): boolean {
    const skill = this.skills.get(id);
    if (!skill) return false;

    this.skills.delete(id);
    this.scopeIndex.get(skill.scope)?.delete(id);
    return true;
  }

  /**
   * Remove all skills of a specific scope.
   */
  removeByScope(scope: SkillScope): number {
    const skills = this.getByScope(scope);
    let count = 0;

    for (const skill of skills) {
      if (this.remove(skill.id)) count++;
    }

    return count;
  }

  /**
   * Clear all registered skills.
   */
  clear(): void {
    this.skills.clear();
    for (const set of this.scopeIndex.values()) {
      set.clear();
    }
  }

  // ===========================================================================
  // Serialization (for debugging)
  // ===========================================================================

  /**
   * Get a summary of all registered skills (for debugging).
   */
  toSummary(): Array<{
    id: string;
    name: string;
    scope: SkillScope;
    location: string;
  }> {
    return this.getAll().map((s) => ({
      id: s.id,
      name: s.name,
      scope: s.scope,
      location: s.location,
    }));
  }
}

// ============================================================================
// Factory
// ============================================================================

export function createSkillRegistry(opts?: RegistryOptions): SkillRegistry {
  return new SkillRegistry(opts);
}
