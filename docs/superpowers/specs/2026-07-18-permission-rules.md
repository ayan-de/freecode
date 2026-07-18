# Permission Rules System — Design Spec

**Date:** 2026-07-18
**Status:** Implemented (v1) — 2026-07-18
**Extends:** `2026-05-25-architecture-v4.md` (permission section)
**Source analysis:** `plans/2026-07-18-claude-code-feature-gap-analysis.md` (#permission rules),
`plans/2026-07-18-jcode-feature-gap-analysis.md` (permission model / wait-or-move-on)

## Goal

Add a user-editable, per-rule permission layer — `allow` / `ask` / `deny`
decisions matched on **tool name + argument pattern** — evaluated before any
tool executes, merged across **project → user** scopes, with the existing
agent modes acting as default policies. Plus a real interactive approval
flow (today "ask" only fires a notification and proceeds).

Example rules:

```jsonc
// .freecode/settings.json (project) or ~/.freecode/settings.json (user)
{
  "permissions": {
    "allow": [
      "Read",
      "Grep",
      "Glob",
      "Bash(npm run test:*)",
      "Bash(git status)",
      "WebFetch(domain:docs.anthropic.com)"
    ],
    "ask": ["Bash(git push:*)", "Write"],
    "deny": ["Read(./secrets/**)", "Read(./.env*)", "Bash(rm -rf:*)"]
  }
}
```

---

## Current State (verified in code)

| Piece | Location | Behavior today |
| ----- | -------- | -------------- |
| Agent modes | `agent/types.ts:17` — `AgentMode = "plan" \| "build" \| "review" \| "explore" \| "danger"`, default `"build"` | Only two modes do anything at the permission layer |
| Plan mode | `agent/loop.ts:853` | Hardcoded block list `["write","edit","delete","bash","agent"]` |
| Danger mode | `agent/loop.ts:905` | Skips `PermissionRequest` hooks entirely — everything allowed |
| PermissionRequest hooks | `hooks/PermissionRequest.ts` | Returns `allow`/`deny`/`ask`; **no matching hooks → `"ask"`** |
| The "ask" gap | `agent/loop.ts:921` | `"ask"` only runs the Notification hook, then **executes anyway**. There is no interactive approval round-trip. |
| Capability profiles | `permission/profiles.ts` | `minimal/readonly/standard/elevated/admin` boolean capability sets, consulted by `tools/orchestrator.ts` via `isToolAllowed` (mainly for subagents) |
| Tool metadata | `tools/factory.ts` | Each tool declares `permissions.requiresApproval` (default `false`) — currently unused by the loop |
| Interactive Q&A infra | `tools/question.ts`, `bus/index.ts` (`askQuestion`), IPC `question.answer`/`question.reject` | The request/await/answer pattern the approval flow will mirror |
| Config dir | `providers/config.ts` — `~/.freecode/` | User-scope settings home already exists |

**Note:** CLAUDE.md describes `permission/profiles.ts` as holding
plan/build/review/explore/danger — it doesn't; those are *agent modes* in
`agent/types.ts`. The profiles file holds capability sets. This spec keeps
both layers distinct (see Non-Goals).

---

## Design

### 1. Rule syntax

A rule is `ToolName` (matches any invocation) or `ToolName(pattern)`.
Tool names are the registry ids (`read`, `write`, `edit`, `bash`, `glob`,
`grep`, `webfetch`, `websearch`, `agent`, `skill`, `question`, `todowrite`,
`lsp`), case-insensitive; MCP tools use their registered
`mcp__server__tool` names, and `mcp__server` matches every tool from that
server.

Pattern semantics per tool family:

| Tool | Pattern matched against | Semantics |
| ---- | ----------------------- | --------- |
| `bash` | the command string | **Prefix match**. `Bash(npm run test:*)` matches `npm run test` and anything after; `Bash(git status)` is exact. `:*` marks "this prefix plus any suffix". |
| `read`, `write`, `edit`, `glob`, `grep` | the target path (resolved, relative to project root when inside it) | **Gitignore-style glob** (`**`, `*`, leading `./` = project-relative, `~/` = home, `//` = absolute). |
| `webfetch`, `websearch` | the URL | `domain:<host>` matches host and subdomains. |
| `agent` | subagent type | Plain string / `*`. |
| MCP tools | none (name-level only) | Argument patterns unsupported in v1. |

Unknown tool names in rules are kept (forward-compat) but never match.

### 2. Decision precedence

For a given tool call, evaluate in strict order — first match wins the
tier, tiers are absolute:

1. **deny** — if any deny rule in any scope matches → deny. Deny is
   unoverridable; a runtime "always allow" can never defeat a deny rule.
2. **ask** — if any ask rule matches → interactive approval.
3. **allow** — if any allow rule matches → execute.
4. **No rule matched** → fall through to the **mode default** (below).

Scope merge: rules from all scopes are concatenated per tier
(project + user + session grants); within a tier, scope doesn't matter —
deny anywhere is deny. This matches Claude Code's model and keeps
evaluation order-independent.

### 3. Scopes

| Scope | File | Written by |
| ----- | ---- | ---------- |
| Project | `<project>/.freecode/settings.json` | User edit, or "always allow (this project)" from the approval prompt |
| User | `~/.freecode/settings.json` | User edit, or "always allow (everywhere)" |
| Session | In-memory only | "allow for this session" from the approval prompt |

Enterprise/managed scope: **not in v1** (YAGNI — no managed-deployment
story yet). The loader is a merge of an ordered scope list, so adding a
scope later is additive.

Files are loaded at session start and reloaded on change (fs.watch on the
two settings files; on parse error, log + treat that scope as empty —
never fail open by crashing the loop).

### 4. Agent modes become default policies

The five existing modes stay; each now means a **default decision table**
applied only when no rule matched (except `plan`'s read-only enforcement
and `danger`'s bypass, which are mode-level and win over rules):

| Mode | Semantics |
| ---- | --------- |
| `plan` | Read-only **enforced**: mutating tools (`write`, `edit`, `bash`, `agent`, mutating MCP) are denied *regardless of allow rules*. Read-only tools: allow. Replaces the hardcoded list in `loop.ts:853` — the list moves into a mode policy table in `permission/`. |
| `build` (default) | Rules first. Unmatched: read-only tools → allow; mutating tools inside project root → **ask**; anything outside project root, network tools, `bash` → **ask**. |
| `review` | Like `plan` (read-only enforced) but `bash` is allowed for read-only commands the rules explicitly allow (e.g. `Bash(git diff:*)`); unmatched → deny. |
| `explore` | Read-only tools auto-allow including outside the project root; mutating → deny. No prompts — it never asks, it answers. |
| `danger` | **Bypass everything: all tools allowed, no rules, no hooks, no prompts.** (Yes — this is the existing `loop.ts:905` behavior, now made explicit as policy. Deny rules are *not* consulted; danger means danger. The CLI/frontend must require explicit opt-in per session.) |

This is what makes the modes "make sense": today only `plan` and `danger`
do anything; after this change every mode is a coherent default policy
that rules refine.

`acceptEdits` (Claude Code) is **not** a new mode: `build` + a session
grant `allow: ["Write", "Edit"]` covers it. Frontends can expose a
shortcut that installs that session grant.

### 5. Evaluation pipeline (replaces current loop logic)

In `agent/loop.ts` `executeToolCall`, ordering:

```
1. danger mode?            → execute (unchanged)
2. mode enforcement        → plan/review/explore hard denies (table-driven)
3. PreToolUse hooks        → block/modify (unchanged)
4. Rules engine            → deny | ask | allow | no-match
5. no-match                → mode default (deny | ask | allow)
6. PermissionRequest hooks → may override ask→allow or anything→deny
                             (hooks keep final say so existing automations
                             still work; default result when no hooks match
                             changes from "ask" to "pass-through")
7. decision == deny        → blocked ToolResult with matched rule in reason
8. decision == ask         → interactive approval (below); denied → blocked
9. execute
```

### 6. Interactive approval flow (the missing piece)

Mirror the question tool's bus pattern:

- New bus request `askPermission(requestId, request, sessionId)` in
  `bus/index.ts`, awaiting a reply like `askQuestion` does.
- New `StreamEvent`:

  ```typescript
  { type: "permission_asked"; requestId: string; sessionId?: string;
    toolName: string; args: Record<string, unknown>;
    description: string;          // human-readable, e.g. the bash command or file path
    suggestedRule?: string;       // e.g. "Bash(npm run test:*)" for "always allow"
    reason?: string }             // which rule/mode default triggered the ask
  ```

- New IPC methods `permission.answer` / `permission.reject` in
  `packages/shared/src/ipc/protocol.ts` (`METHODS`) and `server.ts`,
  same shape as `question.answer`/`question.reject`. Answer payload:

  ```typescript
  { requestId: string;
    decision: "allow-once" | "allow-session" | "allow-project" | "allow-always" | "deny";
    editedRule?: string }         // user may tighten/loosen the suggested rule
  ```

  `allow-session` appends to session grants; `allow-project` /
  `allow-always` append the rule to the project / user settings file (and
  the in-memory rule set immediately).
- **Wait-or-move-on** (jcode): the ask blocks the loop by default. In
  headless/non-interactive contexts (no frontend subscribed to the bus, or
  a timeout configured), the ask resolves to **deny** with a tool-result
  message telling the model it may continue without that action or try a
  different approach — never silent auto-allow.
- Suggested-rule generation lives beside matching in `permission/rules.ts`
  (bash → first word(s) + `:*`; paths → the literal path; webfetch →
  `domain:<host>`).

### 7. New files (all in `apps/core/src/permission/`, ≤150 lines each)

| File | Responsibility |
| ---- | -------------- |
| `rule-types.ts` | `PermissionRule`, `PermissionRuleSet`, `PermissionEvaluation`, settings shape |
| `rules.ts` | Parse `"Tool(pattern)"` strings; per-tool-family matchers (`ruleMatches`, `findMatch`, `extractTarget`) |
| `suggest.ts` | Suggested-rule generation for "always allow" (split from `rules.ts` for file-size limits) |
| `settings.ts` | `PermissionSettingsManager`: load/watch/merge `.freecode/settings.json` scopes, session grants, append-rule writer |
| `evaluate.ts` | The decision function: `evaluatePermission({toolCall, mode, rules, projectRoot}) → { decision, source, matchedRule? }` |
| `mode-policy.ts` | Per-mode enforcement + default tables (plan's read-only list moved here from `loop.ts`) |
| `prompt.ts` | `promptForPermission`: bus round-trip for "ask", applies session grants / persisted rules from the answer |

Touched files: `agent/loop.ts` (pipeline rewiring, delete hardcoded plan
list), `bus/index.ts` (+`askPermission`), `packages/shared/src/ipc/protocol.ts`
(+`StreamEvent` variant, +2 methods), `server.ts` (+2 handlers),
`hooks/PermissionRequest.ts` (default result semantics), frontends
(render the prompt — TUI first; VS Code/Web can initially reuse their
question-tool UI since the shape is parallel).

## Non-Goals (v1)

- **OS-level sandbox enforcement** (grok-build #6) — separate feature;
  this layer is cooperative by design.
- **Enterprise/managed scope**, argument patterns for MCP tools,
  regex rules, per-directory `additionalDirectories` grants.
- **Replacing `permission/profiles.ts`** — the capability profiles remain
  the orchestrator/subagent layer. Convergence is a later refactor;
  don't touch it in this change.
- New agent modes — the five existing ones gain semantics; none are added.

## Security invariants

1. `deny` is absolute — no scope, session grant, hook, or approval answer
   overrides a matched deny rule (only editing the settings file can).
2. `danger` requires explicit per-session opt-in from the frontend and is
   surfaced in the UI while active.
3. Headless "ask" resolves to deny, never allow.
4. Settings parse failures fail closed (scope treated as empty → mode
   defaults apply, which still ask for mutations in `build`).
5. Bash matching is prefix-on-the-raw-command only in v1; compound
   commands (`&&`, `;`, pipes) match against the full string, so
   `Bash(npm:*)` does **not** allow `npm test && rm -rf /` — no rule with
   a separator can match past one. Document this; smarter command-parsing
   is follow-up work.

## Implementation plan

Each step is independently verifiable; write tests first per step
(vitest, colocated `.test.ts` as with `batching.test.ts`).

1. **`rules.ts` + `rule-types.ts`** — parser + matchers.
   → verify: unit tests for every pattern family incl. the compound-bash
   invariant, `~`/`./`//` path anchors, domain matching, case-insensitivity.
2. **`settings.ts`** — scope loading/merging/append-writer.
   → verify: tests with temp dirs; malformed JSON → empty scope; append
   preserves existing file content/format.
3. **`mode-policy.ts` + `evaluate.ts`** — decision function.
   → verify: table-driven tests over (mode × rule × tool) matrix; plan
   denies write even with allow rule; danger short-circuits; deny beats
   session grant.
4. **Bus + IPC** — `askPermission`, `permission_asked` event,
   `permission.answer`/`.reject` methods.
   → verify: unit test the bus round-trip like the question flow; headless
   timeout → deny.
5. **Loop rewiring** — replace hardcoded plan list and the notify-only ask
   path with the pipeline in §5.
   → verify: integration test: build mode + no rules → write asks;
   answering allow-session executes and doesn't re-ask; deny rule blocks
   with rule name in the error.
6. **TUI prompt** — render `permission_asked`, keyboard flow
   (allow once / session / project / always / deny, edit rule).
   → verify: manual run via `freecode` against a scratch project.
7. **Docs** — update CLAUDE.md permission row (fix the
   profiles-vs-modes description), `hooks/hooks-system.md`
   (PermissionRequest default change), and the `/internal` page's
   `HooksNodeContent` link list (add `apps/core/src/permission/`).
