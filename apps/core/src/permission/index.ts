// =============================================================================
// Permission Module - Public API
// PRIMARY: Sandboxes for tool permissions
// =============================================================================

// Types
export type { PermissionProfile, PermissionCheckResult } from "./profiles.js";
export type { PermissionOperation } from "./profiles.js";

// Profiles
export {
  PROFILES,
  getProfile,
  createProfile,
  createPermissionChecker,
  createPermissionCheckerForProfile,
} from "./profiles.js";

// Tool permission mapping
export { TOOL_PERMISSIONS, isToolAllowed } from "./profiles.js";

// Validation
export { validateProfile, isValidProfile } from "./profiles.js";

// PermissionChecker class
export { PermissionChecker } from "./profiles.js";

// Per-rule permission layer (spec: 2026-07-18-permission-rules.md)
export type {
  PermissionRule,
  PermissionRuleDecision,
  PermissionRuleSet,
  PermissionSettings,
  PermissionEvaluation,
  PermissionScope,
} from "./rule-types.js";
export { emptyRuleSet } from "./rule-types.js";
export { parseRule, parseRules, parseRuleSet, ruleMatches, findMatch } from "./rules.js";
export { suggestRule } from "./suggest.js";
export { PermissionSettingsManager, settingsPath, type RuleScope } from "./settings.js";
export { evaluatePermission, type EvaluateInput } from "./evaluate.js";
export { promptForPermission, type PermissionPromptOutcome } from "./prompt.js";
