// =============================================================================
// Permission Rule Types - Shapes for the per-rule permission layer
// Spec: docs/superpowers/specs/2026-07-18-permission-rules.md
// =============================================================================

export type PermissionRuleDecision = "allow" | "ask" | "deny";

export type PermissionScope = "project" | "user" | "session";

/** A parsed rule like `Bash(npm run test:*)` or `Read` */
export interface PermissionRule {
  /** Original rule text, e.g. "Bash(npm run test:*)" */
  raw: string;
  /** Lowercased tool id, e.g. "bash", "mcp__linear" */
  tool: string;
  /** Argument pattern inside parens; undefined matches any invocation */
  pattern?: string;
}

/** Rules grouped by decision tier */
export interface PermissionRuleSet {
  allow: PermissionRule[];
  ask: PermissionRule[];
  deny: PermissionRule[];
}

/** The `permissions` object in .freecode/settings.json */
export interface PermissionSettings {
  allow?: string[];
  ask?: string[];
  deny?: string[];
}

/** Result of evaluating a tool call against rules + mode policy */
export interface PermissionEvaluation {
  decision: PermissionRuleDecision;
  source: "rule" | "session-grant" | "mode-enforced" | "mode-default" | "danger";
  /** Raw text of the rule that matched, when source is a rule tier */
  matchedRule?: string;
}

export function emptyRuleSet(): PermissionRuleSet {
  return { allow: [], ask: [], deny: [] };
}
