// =============================================================================
// Permission Rules - Parse `Tool(pattern)` strings and match tool calls
// Spec: docs/superpowers/specs/2026-07-18-permission-rules.md §1
// =============================================================================

import * as path from "path";
import * as os from "os";
import type { PermissionRule, PermissionRuleSet, PermissionSettings } from "./rule-types.js";

const PATH_TOOLS = new Set(["read", "write", "edit", "glob", "grep"]);
const URL_TOOLS = new Set(["webfetch", "websearch"]);
// Shell separators: a prefix rule never matches a command containing one
const SHELL_SEPARATORS = /(\|\||&&|;|\||\n|`|\$\()/;

// =============================================================================
// Parsing
// =============================================================================

const RULE_RE = /^([A-Za-z0-9_-]+)(?:\((.*)\))?$/;

/** Parse "Bash(npm run test:*)" → { raw, tool: "bash", pattern: "npm run test:*" } */
export function parseRule(raw: string): PermissionRule | null {
  const match = RULE_RE.exec(raw.trim());
  if (!match) return null;
  const [, tool, pattern] = match;
  return { raw: raw.trim(), tool: tool.toLowerCase(), pattern };
}

export function parseRules(raws: string[] | undefined): PermissionRule[] {
  return (raws ?? [])
    .map(parseRule)
    .filter((r): r is PermissionRule => r !== null);
}

export function parseRuleSet(settings: PermissionSettings | undefined): PermissionRuleSet {
  return {
    allow: parseRules(settings?.allow),
    ask: parseRules(settings?.ask),
    deny: parseRules(settings?.deny),
  };
}

// =============================================================================
// Matching
// =============================================================================

/** The argument value a pattern is matched against, per tool family */
export function extractTarget(toolName: string, args: Record<string, unknown>): string | undefined {
  const tool = toolName.toLowerCase();
  if (tool === "bash") return args.command as string | undefined;
  if (PATH_TOOLS.has(tool)) {
    return (args.filePath ?? args.path ?? args.cwd) as string | undefined;
  }
  if (URL_TOOLS.has(tool)) return (args.url ?? args.query) as string | undefined;
  if (tool === "agent") return (args.agentType as string | undefined) ?? "";
  return undefined;
}

export function ruleMatches(
  rule: PermissionRule,
  toolName: string,
  args: Record<string, unknown>,
  projectRoot: string,
): boolean {
  const tool = toolName.toLowerCase();
  const nameMatches =
    rule.tool === tool ||
    (rule.tool.startsWith("mcp__") && tool.startsWith(`${rule.tool}__`));
  if (!nameMatches) return false;
  if (rule.pattern === undefined) return true;
  // MCP tools: argument patterns unsupported in v1 — never match (fail closed)
  if (tool.startsWith("mcp__")) return false;

  if (tool === "bash") return matchBash(rule.pattern, args.command);
  if (PATH_TOOLS.has(tool)) {
    return matchPath(rule.pattern, extractTarget(tool, args), projectRoot);
  }
  if (URL_TOOLS.has(tool)) return matchUrl(rule.pattern, extractTarget(tool, args));
  if (tool === "agent") {
    return rule.pattern === "*" || rule.pattern === extractTarget(tool, args);
  }
  return false;
}

function matchBash(pattern: string, command: unknown): boolean {
  if (typeof command !== "string") return false;
  const cmd = command.trim();
  if (!pattern.endsWith(":*")) return cmd === pattern.trim();
  const prefix = pattern.slice(0, -2).trim();
  if (prefix.length === 0) return true; // "Bash(:*)" degenerates to match-all
  if (!cmd.startsWith(prefix)) return false;
  // Boundary: "npm:*" must not match "npmevil"
  if (cmd.length > prefix.length && !/\s/.test(cmd[prefix.length])) return false;
  // Compound commands never match a prefix rule (see spec §Security 5)
  return !SHELL_SEPARATORS.test(cmd);
}

function matchPath(pattern: string, target: string | undefined, projectRoot: string): boolean {
  if (!target) return false;
  const absTarget = path.resolve(projectRoot, expandHome(target));
  let glob: string;
  let subject: string;
  if (pattern.startsWith("//")) {
    glob = pattern.slice(1);
    subject = absTarget;
  } else if (pattern.startsWith("~/")) {
    glob = path.join(os.homedir(), pattern.slice(2));
    subject = absTarget;
  } else {
    // "./x" and bare "x" are both project-relative
    glob = pattern.startsWith("./") ? pattern.slice(2) : pattern;
    const rel = path.relative(projectRoot, absTarget);
    if (rel.startsWith("..") || path.isAbsolute(rel)) return false;
    subject = rel;
  }
  if (globToRegExp(glob).test(subject)) return true;
  // "dir/**" also covers the directory itself (grep/glob target the dir)
  return glob.endsWith("/**") && globToRegExp(glob.slice(0, -3)).test(subject);
}

function expandHome(p: string): string {
  return p.startsWith("~/") ? path.join(os.homedir(), p.slice(2)) : p;
}

/** Gitignore-style glob: `**` crosses directories, `*`/`?` do not */
export function globToRegExp(glob: string): RegExp {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i];
    if (ch === "*") {
      if (glob[i + 1] === "*") {
        re += ".*";
        i++;
        if (glob[i + 1] === "/") i++; // "**/" also matches zero directories
      } else {
        re += "[^/]*";
      }
    } else if (ch === "?") {
      re += "[^/]";
    } else {
      re += ch.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(`^${re}$`);
}

function matchUrl(pattern: string, target: string | undefined): boolean {
  if (!target) return false;
  if (!pattern.startsWith("domain:")) return pattern === target;
  const domain = pattern.slice("domain:".length).toLowerCase();
  try {
    const host = new URL(target).hostname.toLowerCase();
    return host === domain || host.endsWith(`.${domain}`);
  } catch {
    return false;
  }
}

/** First matching rule in a tier, or undefined */
export function findMatch(
  rules: PermissionRule[],
  toolName: string,
  args: Record<string, unknown>,
  projectRoot: string,
): PermissionRule | undefined {
  return rules.find((r) => ruleMatches(r, toolName, args, projectRoot));
}
