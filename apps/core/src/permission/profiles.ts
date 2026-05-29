// =============================================================================
// Permission Profiles - Sandbox levels for tool permissions
// PRIMARY: Define what operations each agent/session can perform
// PROFILES: minimal, readonly, standard, elevated
// =============================================================================

// ============================================================================
// Permission Profile Interface
// ============================================================================

export interface PermissionProfile {
  name: string
  fileRead: boolean
  fileWrite: boolean
  network: boolean
  shell: boolean
  subprocess: boolean
  mcpServers: string[]  // allowed MCP server names, "*" = all
}

// ============================================================================
// Predefined Profiles
// ============================================================================

export const PROFILES = {
  /** Minimal permissions - read-only, no network, no shell */
  minimal: {
    name: "minimal",
    fileRead: true,
    fileWrite: false,
    network: false,
    shell: false,
    subprocess: false,
    mcpServers: [] as string[],
  } as PermissionProfile,

  /** Read-only with network access (for API calls) */
  readonly: {
    name: "readonly",
    fileRead: true,
    fileWrite: false,
    network: true,
    shell: false,
    subprocess: false,
    mcpServers: [] as string[],
  } as PermissionProfile,

  /** Standard permissions - read/write, shell, but no subprocess spawning */
  standard: {
    name: "standard",
    fileRead: true,
    fileWrite: true,
    network: false,
    shell: true,
    subprocess: false,
    mcpServers: [] as string[],
  } as PermissionProfile,

  /** Elevated - full permissions including subprocess */
  elevated: {
    name: "elevated",
    fileRead: true,
    fileWrite: true,
    network: true,
    shell: true,
    subprocess: true,
    mcpServers: [] as string[],
  } as PermissionProfile,

  /** Admin - maximum permissions for trusted agents */
  admin: {
    name: "admin",
    fileRead: true,
    fileWrite: true,
    network: true,
    shell: true,
    subprocess: true,
    mcpServers: ["*"] as string[], // wildcard = all MCP servers
  } as PermissionProfile,
} as const

// ============================================================================
// Permission Check Result
// ============================================================================

export interface PermissionCheckResult {
  allowed: boolean
  reason?: string
  profile: string
  operation: string
}

// ============================================================================
// Permission Checker
// ============================================================================

export class PermissionChecker {
  private profile: PermissionProfile

  constructor(profile: PermissionProfile) {
    this.profile = profile
  }

  /**
   * Check if a specific operation is allowed
   */
  can(operation: PermissionOperation): PermissionCheckResult {
    const allowed = this.checkOperation(operation)
    return {
      allowed,
      reason: allowed ? undefined : `${operation} is not allowed for profile "${this.profile.name}"`,
      profile: this.profile.name,
      operation,
    }
  }

  /**
   * Check if read operations are allowed
   */
  canRead(): boolean {
    return this.profile.fileRead
  }

  /**
   * Check if write operations are allowed
   */
  canWrite(): boolean {
    return this.profile.fileWrite
  }

  /**
   * Check if network access is allowed
   */
  canNetwork(): boolean {
    return this.profile.network
  }

  /**
   * Check if shell commands are allowed
   */
  canShell(): boolean {
    return this.profile.shell
  }

  /**
   * Check if subprocess spawning is allowed
   */
  canSubprocess(): boolean {
    return this.profile.subprocess
  }

  /**
   * Check if a specific MCP server is allowed
   */
  canMcpServer(serverName: string): boolean {
    if (this.profile.mcpServers.length === 0) return false
    if (this.profile.mcpServers.includes("*")) return true
    return this.profile.mcpServers.includes(serverName)
  }

  /**
   * Get the current profile
   */
  getProfile(): PermissionProfile {
    return { ...this.profile }
  }

  /**
   * Update the profile (for runtime changes)
   */
  updateProfile(updates: Partial<PermissionProfile>): void {
    this.profile = { ...this.profile, ...updates }
  }

  // ===========================================================================
  // Private
  // ===========================================================================

  private checkOperation(operation: PermissionOperation): boolean {
    switch (operation) {
      case "file.read":
        return this.profile.fileRead
      case "file.write":
        return this.profile.fileWrite
      case "network":
        return this.profile.network
      case "shell":
        return this.profile.shell
      case "subprocess":
        return this.profile.subprocess
      case "mcp":
        return this.profile.mcpServers.length > 0
      default:
        return false
    }
  }
}

// ============================================================================
// Permission Operations
// ============================================================================

export type PermissionOperation =
  | "file.read"
  | "file.write"
  | "network"
  | "shell"
  | "subprocess"
  | "mcp"

// ============================================================================
// Factory
// ============================================================================

/**
 * Get a predefined profile by name
 */
export function getProfile(name: keyof typeof PROFILES): PermissionProfile {
  return { ...PROFILES[name] }
}

/**
 * Create a custom profile by overriding fields
 */
export function createProfile(base: keyof typeof PROFILES, overrides: Partial<PermissionProfile>): PermissionProfile {
  return { ...PROFILES[base], ...overrides, name: overrides.name || PROFILES[base].name }
}

/**
 * Create a permission checker from a profile name
 */
export function createPermissionChecker(profileName: keyof typeof PROFILES): PermissionChecker {
  return new PermissionChecker(PROFILES[profileName])
}

/**
 * Create a permission checker from a custom profile
 */
export function createPermissionCheckerForProfile(profile: PermissionProfile): PermissionChecker {
  return new PermissionChecker(profile)
}

// ============================================================================
// Tool Permission Mapping
// ============================================================================

/**
 * Map tool names to required permissions
 */
export const TOOL_PERMISSIONS: Record<string, PermissionOperation[]> = {
  read: ["file.read"],
  write: ["file.write"],
  edit: ["file.read", "file.write"],
  glob: ["file.read"],
  grep: ["file.read"],
  bash: ["shell"],
  agent: ["subprocess"],
  skill: ["file.read"],
  question: ["network"],
  mcp: ["mcp"],
}

/**
 * Check if a tool is allowed under a given profile
 */
export function isToolAllowed(
  toolName: string,
  profile: PermissionProfile
): PermissionCheckResult {
  const required = TOOL_PERMISSIONS[toolName]
  if (!required) {
    // Unknown tools default to minimal permissions
    return {
      allowed: false,
      reason: `Unknown tool "${toolName}" - requires explicit permission`,
      profile: profile.name,
      operation: toolName,
    }
  }

  const checker = new PermissionChecker(profile)
  for (const op of required) {
    if (!checker.can(op)) {
      return {
        allowed: false,
        reason: `Tool "${toolName}" requires ${op} permission which is not available in profile "${profile.name}"`,
        profile: profile.name,
        operation: op,
      }
    }
  }

  return {
    allowed: true,
    profile: profile.name,
    operation: toolName,
  }
}

// ============================================================================
// Validation
// ============================================================================

/**
 * Validate a permission profile has all required fields
 */
export function validateProfile(profile: unknown): PermissionProfile {
  if (!profile || typeof profile !== "object") {
    throw new Error("Profile must be an object")
  }

  const p = profile as Record<string, unknown>

  const requiredFields = ["name", "fileRead", "fileWrite", "network", "shell", "subprocess", "mcpServers"]
  for (const field of requiredFields) {
    if (!(field in p)) {
      throw new Error(`Profile missing required field: ${field}`)
    }
  }

  return profile as PermissionProfile
}

/**
 * Check if a profile is valid (returns true or false)
 */
export function isValidProfile(profile: unknown): profile is PermissionProfile {
  try {
    validateProfile(profile)
    return true
  } catch {
    return false
  }
}