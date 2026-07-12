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
