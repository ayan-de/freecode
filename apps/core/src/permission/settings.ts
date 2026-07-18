// =============================================================================
// Permission Settings - Load/merge/persist rule scopes
// Scopes: project (.freecode/settings.json) → user (~/.freecode/settings.json)
// → session (in-memory grants). Parse failures fail closed (scope = empty).
// Spec: docs/superpowers/specs/2026-07-18-permission-rules.md §3
// =============================================================================

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import type {
  PermissionRule,
  PermissionRuleDecision,
  PermissionRuleSet,
  PermissionSettings,
} from "./rule-types.js";
import { emptyRuleSet } from "./rule-types.js";
import { parseRule, parseRuleSet } from "./rules.js";

export type RuleScope = "project" | "user";

export function settingsPath(scope: RuleScope, projectRoot: string): string {
  return scope === "project"
    ? path.join(projectRoot, ".freecode", "settings.json")
    : path.join(os.homedir(), ".freecode", "settings.json");
}

function readSettingsFile(filePath: string): PermissionSettings {
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw) as { permissions?: PermissionSettings };
    return parsed.permissions ?? {};
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      console.warn(`[Permission] Ignoring unreadable settings at ${filePath}: ${error}`);
    }
    return {};
  }
}

/**
 * Holds the merged rule sets for a session: project + user scopes from disk
 * plus in-memory session grants (allow-only). Reloads on file change.
 */
export class PermissionSettingsManager {
  private merged: PermissionRuleSet = emptyRuleSet();
  private sessionGrants: PermissionRule[] = [];
  private watchers: fs.FSWatcher[] = [];

  constructor(private projectRoot: string) {
    this.reload();
  }

  reload(): void {
    const scopes = (["project", "user"] as const).map((scope) =>
      parseRuleSet(readSettingsFile(settingsPath(scope, this.projectRoot))),
    );
    // Within a tier scope doesn't matter: deny anywhere is deny
    this.merged = {
      allow: scopes.flatMap((s) => s.allow),
      ask: scopes.flatMap((s) => s.ask),
      deny: scopes.flatMap((s) => s.deny),
    };
  }

  /** Merged rules; session grants participate in the allow tier only */
  getRuleSet(): PermissionRuleSet {
    return {
      allow: [...this.merged.allow, ...this.sessionGrants],
      ask: this.merged.ask,
      deny: this.merged.deny,
    };
  }

  getSessionGrants(): PermissionRule[] {
    return [...this.sessionGrants];
  }

  /** "Allow for this session" — in-memory only */
  addSessionGrant(ruleRaw: string): boolean {
    const rule = parseRule(ruleRaw);
    if (!rule) return false;
    this.sessionGrants.push(rule);
    return true;
  }

  /** "Always allow" — append the rule to a settings file and re-merge */
  appendRule(
    scope: RuleScope,
    tier: PermissionRuleDecision,
    ruleRaw: string,
  ): boolean {
    if (!parseRule(ruleRaw)) return false;
    const filePath = settingsPath(scope, this.projectRoot);
    let settings: Record<string, unknown> = {};
    try {
      settings = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    } catch {
      // Missing or invalid file → start fresh (invalid content is replaced;
      // it was already being treated as empty by the loader)
    }
    const permissions = (settings.permissions ?? {}) as Record<string, string[]>;
    const rules = permissions[tier] ?? [];
    if (!rules.includes(ruleRaw)) rules.push(ruleRaw);
    permissions[tier] = rules;
    settings.permissions = permissions;
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, `${JSON.stringify(settings, null, 2)}\n`);
    this.reload();
    return true;
  }

  /** Watch both settings files' directories and reload on change */
  watch(): void {
    if (this.watchers.length > 0) return;
    for (const scope of ["project", "user"] as const) {
      const dir = path.dirname(settingsPath(scope, this.projectRoot));
      if (!fs.existsSync(dir)) continue;
      try {
        const watcher = fs.watch(dir, (_event, file) => {
          if (file === "settings.json") this.reload();
        });
        watcher.unref?.();
        this.watchers.push(watcher);
      } catch {
        // Watching is best-effort; reload() still happens on appendRule
      }
    }
  }

  dispose(): void {
    for (const w of this.watchers) w.close();
    this.watchers = [];
  }
}
