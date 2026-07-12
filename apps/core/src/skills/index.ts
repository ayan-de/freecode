// =============================================================================
// Skills System - Public API
// PRIMARY: Export all skills modules for use by the agent loop and tools
// =============================================================================

// Types
export type {
  SkillScope,
  SkillMetadata,
  Skill,
  SkillMatch,
  LoaderOptions,
  SkillLoadResult,
  RegistryOptions,
  InjectionOptions,
  ManagerOptions,
  SkillsInitializationResult,
} from "./types.js";

// Loader
export { loadAllSkills, loadSkill, skillExists } from "./loader.js";

// Registry
export { SkillRegistry, createSkillRegistry } from "./registry.js";

// Manager
export {
  SkillsManager,
  createSkillsManager,
  getGlobalSkillsManager,
  setGlobalSkillsManager,
  getOrCreateGlobalSkillsManager,
} from "./manager.js";

// Injection
export {
  renderSkillForPrompt,
  renderSkillsForPrompt,
  renderSkillMetadata,
  renderSkillsList,
  renderSkillCompact,
  scoreSkill,
  rankSkills,
  needsTruncation,
  effectiveMaxContentLength,
} from "./injection.js";
