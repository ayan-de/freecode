import type { CommandResolveContext } from "../types.js";

// The /init prompt. The agent does the work with its normal tools; this is only
// the instruction. Kept as a TS string (not a .md asset) so it survives bundling.
export function initTemplate(ctx: CommandResolveContext): string {
  const focus = ctx.args.join(" ").trim();
  return `Create or update this repository's agent instruction file(s).

Write \`AGENTS.md\` as the source of truth, then make \`CLAUDE.md\` identical to it (this repo keeps both files in sync). If either already exists at \`${ctx.cwd}\`, improve it in place rather than rewriting blindly — preserve verified-useful guidance, delete stale or generic content, and reconcile it with the current codebase.

The goal is a compact instruction file that helps future sessions avoid mistakes and ramp up quickly. Every line should answer: "Would an agent likely miss this without help?" If not, leave it out.

User-provided focus or constraints (honor these):
${focus || "(none)"}

## How to investigate

Read the highest-value sources first:
- \`README*\`, root manifests, workspace config, lockfiles
- build, test, lint, formatter, typecheck, and codegen config
- CI workflows and pre-commit / task-runner config
- existing instruction files (\`AGENTS.md\`, \`CLAUDE.md\`, \`.cursor/rules/\`, \`.cursorrules\`, \`.github/copilot-instructions.md\`)

If architecture is still unclear after config and docs, inspect a small number of representative code files to find the real entrypoints, package boundaries, and execution flow. Prefer files that explain how the system is wired together over random leaf files. When docs conflict with config or scripts, trust the executable source.

## What to extract

- exact developer commands, especially non-obvious ones
- how to run a single test, a single package, or a focused verification step
- required command order when it matters (e.g. \`lint -> typecheck -> test\`)
- monorepo / multi-package boundaries, ownership of major directories, real entrypoints
- framework or toolchain quirks: generated code, migrations, codegen, build artifacts, env loading, dev servers
- repo-specific style or workflow conventions that differ from defaults
- testing quirks: fixtures, integration prerequisites, snapshot workflows, required services

## Writing rules

Include only high-signal, repo-specific guidance. Exclude generic software advice, long tutorials, exhaustive file trees, obvious language conventions, and anything you could not verify. Prefer short sections and bullets. If the repo is simple, keep the file simple.

Only ask the user questions if the repo cannot answer something important — use the \`question\` tool for one short batch at most.

When done, confirm both \`AGENTS.md\` and \`CLAUDE.md\` were written and are identical.`;
}
