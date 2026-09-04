// =============================================================================
// Bash tool description.
//
// Kept out of bash.ts because it is prose, not logic: it gets iterated on
// independently of the executor, and it is the only lever we have over *which*
// tool the model reaches for. The routing section below is the point — a
// `cat`/`grep`/`find` run through the shell costs far more context than the
// dedicated tool (no line numbers, no per-tool caps, no read dedup), and the
// model will default to the shell unless told not to.
// =============================================================================

export const BASH_DESCRIPTION = `Run a shell command — for terminal operations: git, package managers, build/test runners, docker, toolchains, one-off scripts.

## Do not use bash for file operations

Dedicated tools cost less context and give more: \`read\` (NOT cat/head/tail/sed -n — it caps output, takes offset/limit, dedups re-reads), \`glob\` (NOT find), \`ls\` for one directory, \`grep\` (NOT grep/rg/ag), \`write\` (NOT echo >/heredoc), \`edit\` (NOT sed -i/awk/perl -i). Use bash for file work only where no tool covers it — \`mv\`, \`chmod\`, \`mkdir -p\`, pipes.

## Running commands

- Non-interactive only: stdin is closed; pass \`-y\`/\`--yes\`/\`--no-input\`.
- Use \`workdir\` instead of \`cd\` (does not carry over). Quote paths with spaces.
- \`timeout\` is milliseconds (default 60000); raise for long builds/tests.
- Chain dependent steps with \`&&\`; send independent commands as parallel tool calls in one message.
- Output is capped; the truncation marker names the \`output\` tool call that pages the rest — use it instead of re-running.

## Git

- Before committing: \`git status\`, \`git diff\`, \`git log --oneline -10\` to match message style; stage files by name — \`git add -A\` sweeps in secrets and other agents' work. Use \`gh\` for PRs/issues/checks.
- Never skip hooks (\`--no-verify\`) or change git config. After a hook rejection make a NEW commit, not \`--amend\`. \`push --force\`, \`reset --hard\`, \`checkout .\`, \`clean -f\`, \`branch -D\` only on explicit request.`;
