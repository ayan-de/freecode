// =============================================================================
// Permission Module - Public API
// PRIMARY: Sandboxes for tool permissions
// =============================================================================

// Types
export type { PermissionProfile, PermissionCheckResult } from "./profiles"
export type { PermissionOperation } from "./profiles"

// Profiles
export { PROFILES, getProfile, createProfile, createPermissionChecker, createPermissionCheckerForProfile } from "./profiles"

// Tool permission mapping
export { TOOL_PERMISSIONS, isToolAllowed } from "./profiles"

// Validation
export { validateProfile, isValidProfile } from "./profiles"

// PermissionChecker class
export { PermissionChecker } from "./profiles"