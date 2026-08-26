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
  "read",
  "ls",
  "glob",
  "grep",
  "skill",
  "question",
  "todowrite",
  "todo",
  "lsp",
  "webfetch",
  "websearch",
  "output",
]);

const NETWORK_TOOLS = new Set(["webfetch", "websearch"]);

/**
 * MCP tools whose server declared them read-only via the `readOnlyHint`
 * annotation. Populated as servers connect, cleared as they disconnect (see
 * `mcp/init.ts`), so the set only ever describes tools currently on offer.
 *
 * Membership is an explicit claim, never an inference: a tool with no
 * annotation, or from a server that never connected, is absent and therefore
 * mutating.
 */
const READONLY_MCP_TOOLS = new Set<string>();

/** Record an MCP tool as read-only. Only ever called for `readOnlyHint: true`. */
export function setMcpToolReadOnly(toolName: string): void {
  READONLY_MCP_TOOLS.add(toolName.toLowerCase());
}

/**
 * Drop every recorded tool under a server prefix (`mcp__linear__`), so a
 * disconnected server can't leave a read-only claim behind for a later tool
 * that happens to reuse the name.
 */
export function clearMcpToolKinds(prefix: string): void {
  const lower = prefix.toLowerCase();
  for (const name of READONLY_MCP_TOOLS) {
    if (name.startsWith(lower)) READONLY_MCP_TOOLS.delete(name);
  }
}

/**
 * Unknown tools are mutating — fail closed.
 *
 * An MCP server is arbitrary third-party code, so an MCP tool is only treated
 * as read-only when its server explicitly said so via `readOnlyHint`. The spec
 * requires mutating MCP tools to be denied in plan mode regardless of allow
 * rules (§4), which is only sound while the unannotated case stays mutating.
 *
 * The cost for an unannotated tool is a prompt on first use in build mode; the
 * escape hatch is a server-level allow rule (`mcp__linear`) covering every tool
 * that server exposes.
 */
export function toolKind(toolName: string): ToolKind {
  const lower = toolName.toLowerCase();
  if (READONLY_MCP_TOOLS.has(lower)) return "readonly";
  return READONLY_TOOLS.has(lower) ? "readonly" : "mutating";
}

export function isNetworkTool(toolName: string): boolean {
  return NETWORK_TOOLS.has(toolName.toLowerCase());
}

/**
 * Whether the mode forbids mutation outright. In these modes "no file changed"
 * is the expected state, not evidence of anything — see the stagnation counter
 * in `agent/loop.ts`, which must not read normal exploration as a stuck loop.
 */
export function isReadOnlyMode(mode: AgentMode): boolean {
  return mode === "plan" || mode === "review" || mode === "explore";
}

/**
 * Mode-level hard deny, evaluated BEFORE rules — an allow rule cannot
 * override these (plan stays read-only no matter what settings say).
 * Returns a reason string when denied, undefined when the mode has no say.
 */
export function modeEnforcement(
  mode: AgentMode,
  toolName: string,
): string | undefined {
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
      return targetsInsideProject(toolName, args, projectRoot)
        ? "allow"
        : "ask";
  }
}

/** explore never prompts — an "ask" outcome downgrades to deny there */
export function modeAllowsAsk(mode: AgentMode): boolean {
  return mode !== "explore";
}
