// =============================================================================
// Hook Settings - Load hooks from settings.json
// Scopes: project (.freecode/settings.json) → user (~/.freecode/settings.json)
// Parse failures fail closed (invalid hooks are skipped with warnings).
// Spec: docs/superpowers/specs/2026-07-31-hooks-settings-design.md
// =============================================================================

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import type { HookEventName, CommandHook } from "./types.js";
import { HOOK_EVENT_NAMES } from "./types.js";
import { registerHook, unregisterAllHooks } from "./registry.js";

// =============================================================================
// Configuration Types
// =============================================================================

/**
 * Hook definition as it appears in settings.json
 */
export interface HookDefinition {
  /** Unique name for this hook within the event */
  name: string;
  /** Tool name pattern to match (e.g., "Write", "Bash", "*", "Write|Edit") */
  matcher?: string;
  /** Shell command to execute */
  command: string;
  /** Shell to use: "bash" (default) or "powershell" */
  shell?: "bash" | "powershell";
  /** Timeout in seconds (default: 300 = 5 minutes) */
  timeout?: number;
  /** Condition pattern like "Write(*.ts)" or "Bash(git *)" */
  if?: string;
  /** Run only once per session (default: false) */
  once?: boolean;
}

/**
 * Raw entry from settings.json - supports both flat and Claude Code shapes
 */
interface RawHookEntry {
  name?: string;
  matcher?: string;
  command?: string;
  shell?: "bash" | "powershell";
  timeout?: number;
  if?: string;
  once?: boolean;
  /** Claude Code nested shape */
  hooks?: RawHookEntry[];
}

// =============================================================================
// Settings Paths
// =============================================================================

export function hooksSettingsPath(
  scope: "project" | "user",
  projectRoot: string,
): string {
  return scope === "project"
    ? path.join(projectRoot, ".freecode", "settings.json")
    : path.join(os.homedir(), ".freecode", "settings.json");
}

// =============================================================================
// Settings Reading
// =============================================================================

function readHooksFromFile(
  filePath: string,
): Record<HookEventName, HookDefinition[]> {
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw) as { hooks?: Record<string, RawHookEntry[]> };
    const rawHooks = parsed.hooks ?? {};

    const normalized: Record<HookEventName, HookDefinition[]> =
      Object.create(null);

    for (const [event, entries] of Object.entries(rawHooks)) {
      if (!isValidEventName(event)) {
        console.warn(
          `[Hooks] Unknown hook event "${event}" - valid events are: ${HOOK_EVENT_NAMES.join(", ")}`,
        );
        continue;
      }

      const hooks: HookDefinition[] = [];
      for (let i = 0; i < (entries ?? []).length; i++) {
        const entry = entries[i];
        const expanded = normalizeEntry(entry, event as HookEventName, i);
        for (const def of expanded) {
          const validated = validateHookDefinition(def, event as HookEventName);
          if (validated) {
            hooks.push(validated);
          }
        }
      }
      normalized[event as HookEventName] = hooks;
    }

    return normalized;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      console.warn(
        `[Hooks] Ignoring unreadable settings at ${filePath}: ${error}`,
      );
    }
    return Object.create(null);
  }
}

/**
 * Check if a string is a valid HookEventName
 */
function isValidEventName(event: string): event is HookEventName {
  return HOOK_EVENT_NAMES.includes(event as HookEventName);
}

/**
 * Normalize a raw entry - handles both flat and Claude Code nested shapes
 */
function normalizeEntry(
  entry: RawHookEntry,
  event: HookEventName,
  index: number,
): HookDefinition[] {
  // Claude Code shape: has hooks[] array
  if (Array.isArray(entry.hooks)) {
    return entry.hooks.flatMap((h, i) => {
      const name = h.name ?? `${event}-${index}-${i}`;
      return [
        {
          name,
          matcher: h.matcher ?? entry.matcher,
          command: h.command ?? "",
          shell: h.shell,
          timeout: h.timeout,
          if: h.if ?? entry.if,
          once: h.once ?? entry.once,
        },
      ];
    });
  }

  // Flat shape (§3.1)
  return [
    {
      name: entry.name ?? `${event}-${index}`,
      matcher: entry.matcher,
      command: entry.command ?? "",
      shell: entry.shell,
      timeout: entry.timeout,
      if: entry.if,
      once: entry.once,
    },
  ];
}

/**
 * Validate a hook definition - returns null if invalid (with warning)
 */
function validateHookDefinition(
  def: HookDefinition,
  event: HookEventName,
): HookDefinition | null {
  if (!def.name) {
    console.warn(
      `[Hooks] Skipping hook in ${event}: missing "name" field`,
    );
    return null;
  }

  if (!def.command) {
    console.warn(
      `[Hooks] Skipping hook "${def.name}" in ${event}: missing "command" field`,
    );
    return null;
  }

  return def;
}

// =============================================================================
// Hook Transformation
// =============================================================================

/**
 * Transform a HookDefinition to a CommandHook (injects type: "command")
 */
function transformToCommandHook(def: HookDefinition): CommandHook {
  return {
    type: "command",
    command: def.command,
    shell: def.shell ?? "bash",
    timeout: def.timeout, // passed through; executors/index.ts does timeout * 1000
    if: def.if,
    once: def.once,
  };
}

// =============================================================================
// HookSettingsManager
// =============================================================================

/**
 * Manages hooks loaded from settings.json files.
 * Supports project (.freecode/settings.json) and user (~/.freecode/settings.json) scopes.
 * Project hooks take precedence over user hooks for the same name.
 */
export class HookSettingsManager {
  private watchers: fs.FSWatcher[] = [];
  private reloadTimeout: NodeJS.Timeout | null = null;
  private projectRoot: string;

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot;
    this.load();
  }

  /** Load and register all hooks from project + user settings */
  load(): void {
    // First, unregister all hooks from settings (for reload)
    unregisterAllHooks("settings");

    // Load user settings first (lower priority)
    const userHooks = readHooksFromFile(
      hooksSettingsPath("user", this.projectRoot),
    );

    // Load project settings second (higher priority - will override)
    const projectHooks = readHooksFromFile(
      hooksSettingsPath("project", this.projectRoot),
    );

    // Merge: project overrides user for same event+name
    const allEvents: HookEventName[] = [
      ...new Set([...Object.keys(userHooks), ...Object.keys(projectHooks)]),
    ] as HookEventName[];

    for (const event of allEvents) {
      const userDefs = userHooks[event] ?? [];
      const projectDefs = projectHooks[event] ?? [];

      // Build a map of user hooks by name for quick lookup
      const userByName = new Map(userDefs.map((d) => [d.name, d]));

      // For each project hook, override user hook with same name
      for (const pDef of projectDefs) {
        userByName.set(pDef.name, pDef);
      }

      // Register all hooks
      for (const def of userByName.values()) {
        const command = transformToCommandHook(def);
        registerHook(event, def.name, command, "settings", {
          matcher: def.matcher,
        });
      }
    }

    console.log("[Hooks] Loaded hooks from settings.json");
  }

  /** Reload hooks (called on file change) */
  reload(): void {
    console.log("[Hooks] Reloading hooks from settings.json");
    this.load();
  }

  /** Start watching settings files for changes */
  watch(): void {
    if (this.watchers.length > 0) return;

    const dirs = [
      path.dirname(hooksSettingsPath("project", this.projectRoot)),
      path.dirname(hooksSettingsPath("user", this.projectRoot)),
    ];

    for (const dir of dirs) {
      if (!fs.existsSync(dir)) continue;
      try {
        const watcher = fs.watch(dir, (_event, filename) => {
          if (filename === "settings.json") {
            this.debouncedReload();
          }
        });
        watcher.unref?.();
        this.watchers.push(watcher);
      } catch {
        // Watching is best-effort; manual reload still works
        console.warn(`[Hooks] Failed to watch ${dir}`);
      }
    }
  }

  private debouncedReload(): void {
    if (this.reloadTimeout) clearTimeout(this.reloadTimeout);
    this.reloadTimeout = setTimeout(() => this.reload(), 300);
  }

  /** Clean up watchers */
  dispose(): void {
    for (const w of this.watchers) w.close();
    this.watchers = [];
    if (this.reloadTimeout) clearTimeout(this.reloadTimeout);
  }
}
