// =============================================================================
// Hook Registry - Registration and discovery of hooks
// =============================================================================

import type {
  HookEventName,
  HookMatcher,
  HookCommand,
  RegisteredHook,
  ToolCallInput,
  HookContext,
} from "./types.js";

// =============================================================================
// Registry Storage
// =============================================================================

const registeredHooks = new Map<HookEventName, RegisteredHook[]>();

// =============================================================================
// Pattern Matching
// =============================================================================

function matchesPattern(input: string, pattern: string): boolean {
  if (!pattern || pattern === "*") {
    return true;
  }

  // Exact match
  if (input === pattern) {
    return true;
  }

  // Regex pattern
  try {
    const regex = new RegExp(pattern);
    if (regex.test(input)) {
      return true;
    }
  } catch {
    // Invalid regex, skip
  }

  // Pipe-separated exact matches (e.g., "Write|Edit")
  if (pattern.includes("|")) {
    const alternatives = pattern.split("|").map((p) => p.trim());
    return alternatives.includes(input);
  }

  return false;
}

function matchesIfCondition(hook: HookCommand, input: ToolCallInput): boolean {
  if (!hook.if) {
    return true;
  }

  // Parse if condition like "Bash(git *)" or "Write(*.ts)"
  const match = hook.if.match(/^(\w+)\((.*)\)$/);
  if (!match) {
    // No pattern, just tool name check
    return matchesPattern(input.toolName, hook.if);
  }

  const [, toolName, pattern] = match;

  if (!matchesPattern(input.toolName, toolName)) {
    return false;
  }

  // Tool name matches, now check input pattern
  if (!pattern || pattern === "*") {
    return true;
  }

  // Apply pattern to tool input
  // Input is Record<string, unknown>, we serialize relevant parts for matching
  const inputStr = serializeInputForMatching(input.toolInput);

  // Handle glob patterns (simple wildcard matching)
  if (pattern.includes("*")) {
    return (
      matchGlob(inputStr, pattern) ||
      matchGlob(inputStr, pattern.replace(/\*/g, ".*"))
    );
  }

  // Try regex
  try {
    const regex = new RegExp(pattern);
    return regex.test(inputStr);
  } catch {
    // Fall back to exact match
    return inputStr === pattern;
  }
}

function serializeInputForMatching(input: Record<string, unknown>): string {
  // Serialize input for pattern matching - extract meaningful values
  const parts: string[] = [];

  // Common useful fields to extract
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined || value === null) continue;
    parts.push(String(value));
  }

  return parts.join(" ");
}

function matchGlob(str: string, pattern: string): boolean {
  // Convert glob pattern to regex
  // * matches anything, ** matches path separators
  const regexPattern = pattern
    .replace(/[.+?^${}()|[\]\\]/g, "\\$&") // Escape regex special chars except *
    .replace(/\*\*/g, ".*") // ** -> .* (any chars including /)
    .replace(/\*/g, "[^\\s]*"); // * -> non-whitespace chars

  try {
    return new RegExp(`^${regexPattern}$`).test(str);
  } catch {
    return false;
  }
}

// =============================================================================
// Registry Operations
// =============================================================================

export function registerHook(
  event: HookEventName,
  name: string,
  command: HookCommand,
  source: RegisteredHook["source"] = "settings",
  options: { pluginRoot?: string; pluginId?: string; matcher?: string } = {},
): void {
  const hooks = registeredHooks.get(event) || [];
  hooks.push({
    name,
    event,
    command,
    matcher: options.matcher,
    source,
    pluginRoot: options.pluginRoot,
    pluginId: options.pluginId,
  });
  registeredHooks.set(event, hooks);
}

export function unregisterHook(event: HookEventName, name: string): void {
  const hooks = registeredHooks.get(event) || [];
  const filtered = hooks.filter((h) => h.name !== name);
  registeredHooks.set(event, filtered);
}

export function unregisterAllHooks(source: RegisteredHook["source"]): void {
  for (const [event, hooks] of registeredHooks.entries()) {
    const filtered = hooks.filter((h) => h.source !== source);
    registeredHooks.set(event, filtered);
  }
}

// =============================================================================
// Hook Matching
// =============================================================================

export function getMatchingHooks(
  event: HookEventName,
  input: ToolCallInput,
  _context: HookContext,
): RegisteredHook[] {
  const hooks = registeredHooks.get(event) || [];

  return hooks.filter((hook) => {
    // Check if matcher pattern matches
    if (hook.matcher) {
      if (!matchesPattern(input.toolName, hook.matcher)) {
        return false;
      }
    }

    // Check if condition matches (from the command)
    if (hook.command.if) {
      if (!matchesIfCondition(hook.command, input)) {
        return false;
      }
    }

    return true;
  });
}

export function getHooksForEvent(event: HookEventName): RegisteredHook[] {
  return registeredHooks.get(event) || [];
}

export function getAllHooks(): Map<HookEventName, RegisteredHook[]> {
  return new Map(registeredHooks);
}

// =============================================================================
// Debug helpers
// =============================================================================

export function listRegisteredHooks(): string {
  const lines: string[] = [];
  for (const [event, hooks] of registeredHooks.entries()) {
    if (hooks.length > 0) {
      lines.push(`${event}:`);
      for (const hook of hooks) {
        lines.push(`  - ${hook.name} (${hook.source})`);
      }
    }
  }
  return lines.length > 0 ? lines.join("\n") : "No hooks registered";
}
