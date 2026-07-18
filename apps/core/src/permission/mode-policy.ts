// =============================================================================
// Mode Policy - What each agent mode enforces and defaults to
// Modes are default policies applied when no rule matched; plan/review/explore
// additionally hard-deny mutations before rules are consulted.
// Spec: docs/superpowers/specs/2026-07-18-permission-rules.md §4
// =============================================================================

import * as path from "path";
import type { AgentMode } from "../agent/types.js";
import type { PermissionRuleDecision } from "./rule-types.js";
import { extractTarget } from "./rules.js";

export type ToolKind = "readonly" | "mutating";

const READONLY_TOOLS = new Set([
  "read", "glob", "grep", "skill", "question", "todowrite", "todo", "lsp",
  "webfetch", "websearch",
]);

const NETWORK_TOOLS = new Set(["webfetch", "websearch"]);

/** Unknown tools (including MCP) are mutating — fail closed */
export function toolKind(toolName: string): ToolKind {
  return READONLY_TOOLS.has(toolName.toLowerCase()) ? "readonly" : "mutating";
}

export function isNetworkTool(toolName: string): boolean {
  return NETWORK_TOOLS.has(toolName.toLowerCase());
}

/**
 * Mode-level hard deny, evaluated BEFORE rules — an allow rule cannot
 * override these (plan stays read-only no matter what settings say).
 * Returns a reason string when denied, undefined when the mode has no say.
 */
export function modeEnforcement(mode: AgentMode, toolName: string): string | undefined {
  if (toolKind(toolName) === "readonly") return undefined;
  switch (mode) {
    case "plan":
      return `Tool "${toolName}" is not allowed in plan mode (read-only)`;
    case "review":
      // review lets rules explicitly allow read-only bash commands
      if (toolName.toLowerCase() === "bash") return undefined;
      return `Tool "${toolName}" is not allowed in review mode (read-only)`;
    case "explore":
      return `Tool "${toolName}" is not allowed in explore mode (read-only)`;
    default:
      return undefined;
  }
}

/** Whether a tool call's target stays inside the project root */
function targetsInsideProject(
  toolName: string,
  args: Record<string, unknown>,
  projectRoot: string,
): boolean {
  const target = extractTarget(toolName, args);
  if (!target || isNetworkTool(toolName) || toolName.toLowerCase() === "bash") {
    return true; // no path target to judge — handled by kind/network checks
  }
  const rel = path.relative(projectRoot, path.resolve(projectRoot, target));
  return !rel.startsWith("..") && !path.isAbsolute(rel);
}

/** Decision when no rule matched (spec §4 table) */
export function modeDefault(
  mode: AgentMode,
  toolName: string,
  args: Record<string, unknown>,
  projectRoot: string,
): PermissionRuleDecision {
  const kind = toolKind(toolName);
  switch (mode) {
    case "plan":
    case "explore":
      return kind === "readonly" ? "allow" : "deny";
    case "review":
      // mutating tools other than bash were already mode-enforced away
      return kind === "readonly" ? "allow" : "deny";
    case "build":
    default:
      if (kind === "mutating") return "ask";
      if (isNetworkTool(toolName)) return "ask";
      return targetsInsideProject(toolName, args, projectRoot) ? "allow" : "ask";
  }
}

/** explore never prompts — an "ask" outcome downgrades to deny there */
export function modeAllowsAsk(mode: AgentMode): boolean {
  return mode !== "explore";
}
