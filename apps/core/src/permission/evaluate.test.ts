import test from "node:test";
import assert from "node:assert/strict";
import { evaluatePermission } from "./evaluate.js";
import { parseRuleSet } from "./rules.js";
import { emptyRuleSet } from "./rule-types.js";
import type { AgentMode } from "../agent/types.js";

const ROOT = "/proj";

function evaluate(
  mode: AgentMode,
  toolName: string,
  args: Record<string, unknown>,
  rules = emptyRuleSet(),
) {
  return evaluatePermission({ toolName, args, mode, rules, projectRoot: ROOT });
}

// =============================================================================
// Danger mode
// =============================================================================

test("danger mode allows everything, even against a deny rule", () => {
  const rules = parseRuleSet({ deny: ["Bash"] });
  const result = evaluate("danger", "bash", { command: "rm -rf /" }, rules);
  assert.deepEqual(result, { decision: "allow", source: "danger" });
});

// =============================================================================
// Mode enforcement (beats allow rules)
// =============================================================================

test("plan mode denies mutating tools even with an allow rule", () => {
  const rules = parseRuleSet({ allow: ["Write", "Bash"] });
  assert.equal(evaluate("plan", "write", { filePath: "/proj/a.ts" }, rules).decision, "deny");
  assert.equal(evaluate("plan", "bash", { command: "ls" }, rules).decision, "deny");
  assert.equal(evaluate("plan", "write", {}).source, "mode-enforced");
});

test("plan and explore modes allow read-only tools", () => {
  assert.equal(evaluate("plan", "read", { filePath: "/proj/a.ts" }).decision, "allow");
  assert.equal(evaluate("explore", "grep", { pattern: "x" }).decision, "allow");
});

test("review mode denies write/edit/agent but lets rules allow bash", () => {
  const rules = parseRuleSet({ allow: ["Bash(git diff:*)"] });
  assert.equal(evaluate("review", "write", { filePath: "/proj/a" }, rules).decision, "deny");
  assert.equal(evaluate("review", "bash", { command: "git diff HEAD" }, rules).decision, "allow");
  // unmatched bash in review → deny, never ask
  assert.equal(evaluate("review", "bash", { command: "npm install" }, rules).decision, "deny");
});

test("explore never asks — ask outcomes downgrade to deny", () => {
  const rules = parseRuleSet({ ask: ["Read(./secrets/**)"] });
  const result = evaluate("explore", "read", { filePath: "/proj/secrets/k" }, rules);
  assert.equal(result.decision, "deny");
});

// =============================================================================
// Rule precedence: deny > ask > allow, session grants never beat deny
// =============================================================================

test("deny beats ask and allow for the same call", () => {
  const rules = parseRuleSet({
    allow: ["Bash(git push:*)"],
    ask: ["Bash(git push:*)"],
    deny: ["Bash(git push:*)"],
  });
  const result = evaluate("build", "bash", { command: "git push origin" }, rules);
  assert.equal(result.decision, "deny");
  assert.equal(result.source, "rule");
  assert.equal(result.matchedRule, "Bash(git push:*)");
});

test("a session grant (allow tier) cannot override a deny rule", () => {
  // settings manager appends session grants to the allow tier; deny still wins
  const rules = parseRuleSet({ allow: ["Read(./secrets/**)"], deny: ["Read(./secrets/**)"] });
  assert.equal(evaluate("build", "read", { filePath: "/proj/secrets/k" }, rules).decision, "deny");
});

test("ask beats allow", () => {
  const rules = parseRuleSet({ allow: ["Write"], ask: ["Write(./prod/**)"] });
  assert.equal(evaluate("build", "write", { filePath: "/proj/prod/a" }, rules).decision, "ask");
  assert.equal(evaluate("build", "write", { filePath: "/proj/src/a" }, rules).decision, "allow");
});

// =============================================================================
// Build mode defaults (no rule matched)
// =============================================================================

test("build mode: unmatched read-only inside project allows, mutation asks", () => {
  assert.deepEqual(evaluate("build", "read", { filePath: "/proj/a.ts" }), {
    decision: "allow",
    source: "mode-default",
  });
  assert.equal(evaluate("build", "write", { filePath: "/proj/a.ts" }).decision, "ask");
  assert.equal(evaluate("build", "bash", { command: "ls" }).decision, "ask");
});

test("build mode: reads outside the project root and network tools ask", () => {
  assert.equal(evaluate("build", "read", { filePath: "/etc/passwd" }).decision, "ask");
  assert.equal(evaluate("build", "webfetch", { url: "https://x.com" }).decision, "ask");
});

test("build mode: unknown/MCP tools are mutating and ask by default", () => {
  assert.equal(evaluate("build", "mcp__linear__create_issue", {}).decision, "ask");
});

test("allow rules satisfy build-mode asks", () => {
  const rules = parseRuleSet({ allow: ["Bash(npm run test:*)", "mcp__linear"] });
  assert.equal(evaluate("build", "bash", { command: "npm run test" }, rules).decision, "allow");
  assert.equal(evaluate("build", "mcp__linear__create_issue", {}, rules).decision, "allow");
});
